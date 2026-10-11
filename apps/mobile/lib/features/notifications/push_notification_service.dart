import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../../core/config/flavor.dart';
import '../../core/router/app_router.dart';
import '../../core/router/driver_router.dart';
import 'data/notifications_repository.dart';

/// Android-only receive + deep-link half of Phase 7's push pipeline (Phase 10.2, docs/plan.md
/// §5) - the backend send side (including the driver ride-offer push, `RideDriverNotified` ->
/// `offeredDriver` in push-recipients.ts) was already fully built; nothing in `apps/mobile`
/// called any of it until now. iOS is out of scope - no iOS flavor split exists yet.
///
/// Must run as a top-level/static function, not a method - FCM invokes this in a separate
/// background isolate with no access to any app state, so it re-initializes Firebase itself.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  // No custom work needed here: every push this app sends carries a `notification` payload
  // (push-notification.consumer.ts), so the OS auto-displays it while backgrounded/killed using
  // the channel declared in AndroidManifest.xml - this handler exists only because
  // firebase_messaging requires one to be registered for background messages to be delivered
  // at all.
}

const _rideUpdatesChannel = AndroidNotificationChannel(
  'ride_updates',
  'Ride updates',
  description: 'Ride offers, assignment, and status changes.',
  importance: Importance.high,
);

/// Event types from the push payload's `data.eventType` that a driver (not a rider) should be
/// deep-linked for - mirrors `push-recipients.ts`'s only driver-routed push event.
const _driverEventTypes = {'RideDriverNotified'};

class PushNotificationService {
  PushNotificationService({NotificationsRepository? notificationsRepository})
    : _notificationsRepository = notificationsRepository ?? NotificationsRepository();

  final NotificationsRepository _notificationsRepository;
  final _localNotifications = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    await _localNotifications.initialize(
      settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
      onDidReceiveNotificationResponse: (response) {
        final rideId = response.payload;
        if (rideId != null) _navigate(eventType: null, rideId: rideId);
      },
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_rideUpdatesChannel);

    // Also requests the Android 13+ POST_NOTIFICATIONS runtime permission.
    await FirebaseMessaging.instance.requestPermission();

    FirebaseMessaging.onMessage.listen(_showForegroundNotification);
    FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

    // App launched by tapping a notification from a fully-terminated state.
    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) _handleNotificationTap(initialMessage);
  }

  /// Call after login (and again any time the access token is confirmed valid) - registers this
  /// device's current FCM token with the backend. Best-effort: a failure here degrades to "no
  /// push this session", not a broken login.
  Future<void> registerDeviceToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _notificationsRepository.registerDeviceToken(token);
    } catch (error) {
      debugPrint('PushNotificationService: failed to register device token: $error');
    }
  }

  /// Call on logout, before clearing the session - best-effort, same reasoning as above.
  Future<void> unregisterDeviceToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _notificationsRepository.unregisterDeviceToken(token);
    } catch (error) {
      debugPrint('PushNotificationService: failed to unregister device token: $error');
    }
  }

  void _showForegroundNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;
    // firebase_messaging alone doesn't surface a system notification while the app is
    // foregrounded on Android - flutter_local_notifications fills that gap.
    _localNotifications.show(
      id: notification.hashCode,
      title: notification.title,
      body: notification.body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(_rideUpdatesChannelId, _rideUpdatesChannelName, importance: Importance.high),
      ),
      payload: message.data['rideId'] as String?,
    );
  }

  void _handleNotificationTap(RemoteMessage message) {
    _navigate(eventType: message.data['eventType'] as String?, rideId: message.data['rideId'] as String?);
  }

  void _navigate({required String? eventType, required String? rideId}) {
    if (FlavorConfig.isDriver) {
      if (eventType != null && _driverEventTypes.contains(eventType)) {
        driverRouter.push('/driver/incoming-offer');
      }
      // Other driver-facing events (ride cancelled by rider, etc.) just open the app to its
      // home screen, which already renders whatever the driver's current active ride/offer is.
      return;
    }
    // Every rider-facing push event is a ride-lifecycle change; Home already resumes whatever
    // the ride's current state is via RideController's own WS resync (docs/plan.md Phase 5) -
    // no need to duplicate that state logic here just to pick a more specific screen.
    appRouter.go('/home');
  }
}

const _rideUpdatesChannelId = 'ride_updates';
const _rideUpdatesChannelName = 'Ride updates';

/// App-wide singleton - `main_user.dart`/`main_driver.dart` call [PushNotificationService.initialize]
/// once at startup, and `auth_provider.dart` calls [PushNotificationService.registerDeviceToken]/
/// [PushNotificationService.unregisterDeviceToken] on the same instance around login/logout.
final pushNotificationService = PushNotificationService();

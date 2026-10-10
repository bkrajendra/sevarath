import 'package:flutter_test/flutter_test.dart';
import 'package:sevarath_mobile/features/ride/models/ride.dart';

Map<String, dynamic> _rideJson({
  String status = 'SEARCHING_DRIVER',
  Map<String, dynamic>? driver,
  String? vehicleCode,
}) {
  return {
    'id': 'ride-1',
    'userId': 'user-1',
    'driverId': driver != null ? 'driver-1' : null,
    'vehicleId': vehicleCode != null ? 'vehicle-1' : null,
    'pickupLatitude': 24.53,
    'pickupLongitude': 72.79,
    'pickupLocationName': 'Main Gate',
    'destinationLatitude': 24.54,
    'destinationLongitude': 72.80,
    'destinationLocationName': 'Shantivan',
    'status': status,
    'driver': driver,
    'vehicleCode': vehicleCode,
    'requestedAt': '2026-10-10T06:00:00.000Z',
    'acceptedAt': null,
    'driverArrivedAt': null,
    'startedAt': null,
    'completedAt': null,
    'cancelledAt': null,
  };
}

void main() {
  group('Ride.fromJson', () {
    test('parses a freshly-requested ride with no driver yet', () {
      final ride = Ride.fromJson(_rideJson());

      expect(ride.id, 'ride-1');
      expect(ride.status, RideStatus.searchingDriver);
      expect(ride.driver, isNull);
      expect(ride.vehicleCode, isNull);
      expect(ride.isActive, isFalse);
      expect(ride.isTerminal, isFalse);
    });

    test('parses an assigned ride with the embedded driver/vehicle summary', () {
      final ride = Ride.fromJson(
        _rideJson(
          status: 'DRIVER_ASSIGNED',
          driver: {'id': 'driver-1', 'name': 'Suresh Kumar', 'mobile': '9999999999', 'driverCode': 'DRV-1'},
          vehicleCode: 'EV-03',
        ),
      );

      expect(ride.driver!.name, 'Suresh Kumar');
      expect(ride.vehicleCode, 'EV-03');
      expect(ride.isActive, isTrue);
    });

    test('throws on an unknown status string rather than silently misclassifying it', () {
      expect(() => Ride.fromJson(_rideJson(status: 'SOME_FUTURE_STATUS')), throwsArgumentError);
    });

    test('a cancelled ride is terminal', () {
      final ride = Ride.fromJson(_rideJson(status: 'CANCELLED_BY_USER'));
      expect(ride.isTerminal, isTrue);
      expect(ride.isActive, isFalse);
    });
  });

  group('routeForRideStatus', () {
    test('routes pre-assignment statuses to Finding Vehicle', () {
      expect(routeForRideStatus(RideStatus.requested), '/finding-vehicle');
      expect(routeForRideStatus(RideStatus.searchingDriver), '/finding-vehicle');
      expect(routeForRideStatus(RideStatus.noDriverAvailable), '/finding-vehicle');
    });

    test('routes assigned/en-route-to-pickup/arrived statuses to Driver En Route', () {
      expect(routeForRideStatus(RideStatus.driverAssigned), '/driver-en-route');
      expect(routeForRideStatus(RideStatus.driverEnRouteToPickup), '/driver-en-route');
      expect(routeForRideStatus(RideStatus.driverArrived), '/driver-en-route');
    });

    test('routes in-progress statuses to On The Way', () {
      expect(routeForRideStatus(RideStatus.rideStarted), '/on-the-way');
      expect(routeForRideStatus(RideStatus.driverEnRouteToDestination), '/on-the-way');
    });

    test('terminal statuses have no resume route', () {
      expect(routeForRideStatus(RideStatus.completed), isNull);
      expect(routeForRideStatus(RideStatus.cancelledByUser), isNull);
      expect(routeForRideStatus(RideStatus.cancelledByDriver), isNull);
      expect(routeForRideStatus(RideStatus.cancelledBySystem), isNull);
    });
  });
}

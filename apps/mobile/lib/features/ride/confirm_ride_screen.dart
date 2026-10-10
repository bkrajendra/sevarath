import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';
import '../../shared/widgets/campus_map_preview.dart';
import '../destination/data/campus_locations_repository.dart';
import 'models/ride_models.dart';
import 'providers/ride_provider.dart';

/// A stop within this distance of the device's GPS fix is shown/sent as "pickup near" that stop
/// instead of a bare "Current Location" - purely a display/pickupLocationName nicety, the raw
/// GPS coordinates (not the stop's) are always what's actually sent as pickupLatitude/Longitude.
const _nearbyStopThresholdMeters = 150.0;

/// Rough ETA only - no routing engine is wired into the mobile app yet (Valhalla integration is
/// backend-only today, see docs/plan.md Phase 6). A straight-line distance over a flat assumed
/// campus-cart speed is an honest estimate, not a disguised placeholder string.
const _assumedAverageSpeedKmh = 15.0;

class ConfirmRideScreen extends ConsumerStatefulWidget {
  const ConfirmRideScreen({super.key, required this.destination});

  final CampusLocationUi? destination;

  @override
  ConsumerState<ConfirmRideScreen> createState() => _ConfirmRideScreenState();
}

class _ConfirmRideScreenState extends ConsumerState<ConfirmRideScreen> {
  Position? _position;
  String? _locationError;
  bool _resolvingLocation = true;

  /// A rider-chosen pickup point (via the pickup row's "Select Pickup Location" picker),
  /// overriding the GPS-derived [_position] below. Null means "use my current location",
  /// the only option before this feature existed.
  CampusLocationUi? _pickupOverride;

  @override
  void initState() {
    super.initState();
    _resolvePickup();
  }

  Future<void> _resolvePickup() async {
    setState(() {
      _resolvingLocation = true;
      _locationError = null;
    });
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        setState(() {
          _locationError = 'Location services are off. Enable them to request a ride.';
          _resolvingLocation = false;
        });
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() {
          _locationError = 'Location permission is required to request a ride.';
          _resolvingLocation = false;
        });
        return;
      }
      final position = await Geolocator.getCurrentPosition();
      setState(() {
        _position = position;
        _resolvingLocation = false;
      });
    } catch (_) {
      setState(() {
        _locationError = 'Could not determine your location.';
        _resolvingLocation = false;
      });
    }
  }

  CampusLocationUi? _nearestStop(List<CampusLocationUi> locations, Position position) {
    CampusLocationUi? nearest;
    double? nearestDistance;
    for (final loc in locations) {
      final distance = Geolocator.distanceBetween(
        position.latitude,
        position.longitude,
        loc.latitude,
        loc.longitude,
      );
      if (nearestDistance == null || distance < nearestDistance) {
        nearestDistance = distance;
        nearest = loc;
      }
    }
    if (nearest == null || nearestDistance == null || nearestDistance > _nearbyStopThresholdMeters) {
      return null;
    }
    return nearest;
  }

  Future<void> _confirm(
    CampusLocationUi destination,
    double pickupLatitude,
    double pickupLongitude,
    String? pickupLocationName,
  ) async {
    final controller = ref.read(rideControllerProvider.notifier);
    final ok = await controller.requestRide(
      pickupLatitude: pickupLatitude,
      pickupLongitude: pickupLongitude,
      pickupLocationName: pickupLocationName,
      destinationLatitude: destination.latitude,
      destinationLongitude: destination.longitude,
      destinationLocationName: destination.name,
    );
    if (ok && mounted) {
      context.pushReplacement('/finding-vehicle');
    }
  }

  Future<void> _choosePickupLocation() async {
    final selected = await context.push<CampusLocationUi>('/select-pickup');
    if (selected != null) {
      setState(() => _pickupOverride = selected);
    }
  }

  @override
  Widget build(BuildContext context) {
    final destination = widget.destination;
    if (destination == null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('No destination selected', style: AppTextStyles.bodyStrong),
                const SizedBox(height: 12),
                OutlinedButton(onPressed: () => context.pop(), child: const Text('Go Back')),
              ],
            ),
          ),
        ),
      );
    }

    if (_resolvingLocation) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_locationError != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_locationError!, style: AppTextStyles.body, textAlign: TextAlign.center),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: _resolvePickup, child: const Text('Retry')),
              ],
            ),
          ),
        ),
      );
    }

    final position = _position!;
    final pickupOverride = _pickupOverride;
    final locationsAsync = ref.watch(campusLocationsProvider);
    final nearestStop = pickupOverride == null
        ? locationsAsync.maybeWhen(
            data: (locations) => _nearestStop(locations, position),
            orElse: () => null,
          )
        : null;

    final pickupLatitude = pickupOverride?.latitude ?? position.latitude;
    final pickupLongitude = pickupOverride?.longitude ?? position.longitude;
    final pickupLocationName = pickupOverride?.name ?? nearestStop?.name;
    final pickupLabel = pickupOverride?.name ?? (nearestStop != null ? 'Near ${nearestStop.name}' : 'Current Location');
    final pickupSubtitle = pickupOverride != null ? pickupOverride.category : 'Your location · tap to change';

    final distanceKm =
        Geolocator.distanceBetween(pickupLatitude, pickupLongitude, destination.latitude, destination.longitude) / 1000;
    final etaMinutes = (distanceKm / _assumedAverageSpeedKmh * 60).ceil().clamp(1, 999);

    final rideState = ref.watch(rideControllerProvider);

    return Scaffold(
      body: Column(
        children: [
          Expanded(
            flex: 3,
            child: Stack(
              children: [
                Positioned.fill(
                  child: CampusMapPreview(
                    pickup: LatLng(pickupLatitude, pickupLongitude),
                    destination: LatLng(destination.latitude, destination.longitude),
                    center: LatLng(pickupLatitude, pickupLongitude),
                  ),
                ),
                Positioned(
                  top: 0,
                  left: 0,
                  // A bare (non-Positioned) Stack child makes the Stack
                  // shrink-wrap to that child's size instead of filling the
                  // Expanded area, which was squashing the map next to it
                  // down to the back button's own width. Positioned keeps
                  // the Stack sized to its full constraints.
                  child: SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: _BackButton(onTap: () => context.pop()),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 2,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 16,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  InkWell(
                    onTap: _choosePickupLocation,
                    child: Row(
                      children: [
                        Expanded(
                          child: _RouteRow(
                            dotColor: AppColors.pickupGreen,
                            title: pickupLabel,
                            subtitle: pickupSubtitle,
                          ),
                        ),
                        const Icon(Icons.edit_location_alt_outlined, size: 18, color: AppColors.textSecondary),
                      ],
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(left: 5),
                    child: SizedBox(
                      height: 16,
                      child: VerticalDivider(thickness: 2, width: 2),
                    ),
                  ),
                  _RouteRow(
                    dotColor: AppColors.destinationRed,
                    title: destination.name,
                    subtitle: destination.category,
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Icon(
                        Icons.directions_car_filled_rounded,
                        size: 18,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(width: 6),
                      Text('${distanceKm.toStringAsFixed(1)} km', style: AppTextStyles.secondary),
                      const SizedBox(width: 16),
                      const Icon(
                        Icons.access_time_rounded,
                        size: 18,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(width: 6),
                      Text('~ $etaMinutes min', style: AppTextStyles.secondary),
                    ],
                  ),
                  if (rideState.errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      rideState.errorMessage!,
                      style: AppTextStyles.secondary.copyWith(color: AppColors.error),
                    ),
                  ],
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: rideState.isRequesting
                          ? null
                          : () => _confirm(destination, pickupLatitude, pickupLongitude, pickupLocationName),
                      child: rideState.isRequesting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Request Ride'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RouteRow extends StatelessWidget {
  const _RouteRow({
    required this.dotColor,
    required this.title,
    required this.subtitle,
  });

  final Color dotColor;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppTextStyles.bodyStrong),
              Text(subtitle, style: AppTextStyles.caption),
            ],
          ),
        ),
      ],
    );
  }
}

class _BackButton extends StatelessWidget {
  const _BackButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: const Padding(
          padding: EdgeInsets.all(10),
          child: Icon(Icons.arrow_back_rounded, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../core/theme/app_colors.dart';

/// Shared map surface for ride screens (Confirm Ride, Driver En Route, On The
/// Way). Uses OpenFreeMap's public "liberty" style for now (full base map:
/// roads, buildings, land use) - swap `styleString` for the self-hosted
/// Martin style (see k8s/maps/README.md) once Planetiler base tiles are
/// built for the campus region (docs/plan.md Phase 3 open item).
class CampusMapPreview extends StatefulWidget {
  const CampusMapPreview({
    super.key,
    this.pickup,
    this.destination,
    this.vehiclePosition,
    this.center = const LatLng(24.4828, 72.7820),
    this.zoom = 15.5,
  });

  final LatLng? pickup;
  final LatLng? destination;
  final LatLng? vehiclePosition;
  final LatLng center;
  final double zoom;

  @override
  State<CampusMapPreview> createState() => _CampusMapPreviewState();
}

class _CampusMapPreviewState extends State<CampusMapPreview> {
  MapLibreMapController? _controller;

  Future<void> _onStyleLoaded() async {
    final controller = _controller;
    if (controller == null) return;

    // Web only, no-op elsewhere: when this widget mounts mid route-push
    // transition (e.g. pushed straight from the previous screen, as Confirm
    // Ride is), maplibre_gl's container ResizeObserver can catch the map's
    // transient in-transition size and never recheck once the transition
    // settles, leaving the canvas stuck tiny. Force a resize now and again
    // once the push transition (~300ms) has finished.
    controller.forceResizeWebMap();
    Future.delayed(const Duration(milliseconds: 350), () {
      if (mounted) _controller?.forceResizeWebMap();
    });

    if (widget.pickup != null && widget.destination != null) {
      await controller.addLine(
        LineOptions(
          geometry: [widget.pickup!, widget.destination!],
          lineColor: '#14524A',
          lineWidth: 4,
          lineOpacity: 0.85,
        ),
      );
    }

    if (widget.pickup != null) {
      await controller.addCircle(
        CircleOptions(
          geometry: widget.pickup,
          circleRadius: 9,
          circleColor: '#22A45D',
          circleStrokeColor: '#FFFFFF',
          circleStrokeWidth: 3,
        ),
      );
    }
    if (widget.destination != null) {
      await controller.addCircle(
        CircleOptions(
          geometry: widget.destination,
          circleRadius: 9,
          circleColor: '#E94E3C',
          circleStrokeColor: '#FFFFFF',
          circleStrokeWidth: 3,
        ),
      );
    }
    if (widget.vehiclePosition != null) {
      await controller.addCircle(
        CircleOptions(
          geometry: widget.vehiclePosition,
          circleRadius: 8,
          circleColor: '#2F80ED',
          circleStrokeColor: '#FFFFFF',
          circleStrokeWidth: 3,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // LayoutBuilder gives the platform view its final pixel size up front.
    // On Flutter Web, maplibre_gl only re-syncs its canvas on a browser
    // window resize; a map created inside a Stack/Expanded chain without a
    // concrete size can get stuck rendering at a stale, tiny size. Keying on
    // the rounded size also forces a clean remount (rather than a buggy
    // in-place resize) if the available space genuinely changes later.
    return LayoutBuilder(
      builder: (context, constraints) {
        return SizedBox(
          width: constraints.maxWidth,
          height: constraints.maxHeight,
          child: MapLibreMap(
            key: ValueKey(
              'campus-map-${constraints.maxWidth.round()}x${constraints.maxHeight.round()}',
            ),
            styleString: MapLibreStyles.openfreemapLiberty,
            initialCameraPosition: CameraPosition(
              target: widget.center,
              zoom: widget.zoom,
            ),
            myLocationEnabled: false,
            compassEnabled: false,
            attributionButtonPosition: AttributionButtonPosition.bottomLeft,
            onMapCreated: (controller) => _controller = controller,
            onStyleLoadedCallback: _onStyleLoaded,
          ),
        );
      },
    );
  }
}

/// Lightweight "you are here" / vehicle marker overlay for use outside the
/// map (e.g. a floating chip), matching the blue dot in branding-ui.png.
class YouAreHereDot extends StatelessWidget {
  const YouAreHereDot({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 16,
      decoration: BoxDecoration(
        color: AppColors.youAreHereBlue,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
      ),
    );
  }
}

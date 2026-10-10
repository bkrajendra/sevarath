/// Mirrors apps/api/src/rides/dto/ride-response.dto.ts's RIDE_STATUS_VALUES exactly - keep in
/// sync with that file if the backend's ride-state-machine.ts ever adds/renames a status.
enum RideStatus {
  requested,
  searchingDriver,
  driverAssigned,
  driverEnRouteToPickup,
  driverArrived,
  rideStarted,
  driverEnRouteToDestination,
  completed,
  cancelledByUser,
  cancelledByDriver,
  cancelledBySystem,
  noDriverAvailable,
}

const Map<String, RideStatus> _rideStatusByWireName = {
  'REQUESTED': RideStatus.requested,
  'SEARCHING_DRIVER': RideStatus.searchingDriver,
  'DRIVER_ASSIGNED': RideStatus.driverAssigned,
  'DRIVER_EN_ROUTE_TO_PICKUP': RideStatus.driverEnRouteToPickup,
  'DRIVER_ARRIVED': RideStatus.driverArrived,
  'RIDE_STARTED': RideStatus.rideStarted,
  'DRIVER_EN_ROUTE_TO_DESTINATION': RideStatus.driverEnRouteToDestination,
  'COMPLETED': RideStatus.completed,
  'CANCELLED_BY_USER': RideStatus.cancelledByUser,
  'CANCELLED_BY_DRIVER': RideStatus.cancelledByDriver,
  'CANCELLED_BY_SYSTEM': RideStatus.cancelledBySystem,
  'NO_DRIVER_AVAILABLE': RideStatus.noDriverAvailable,
};

RideStatus rideStatusFromWire(String value) {
  final status = _rideStatusByWireName[value];
  if (status == null) {
    throw ArgumentError('Unknown ride status from backend: $value');
  }
  return status;
}

/// Statuses where a driver is actively engaged with the rider - matches
/// apps/api/src/locations/location.gateway.ts's ACTIVE_RIDE_STATUSES.
const activeRideStatuses = {
  RideStatus.driverAssigned,
  RideStatus.driverEnRouteToPickup,
  RideStatus.driverArrived,
  RideStatus.rideStarted,
  RideStatus.driverEnRouteToDestination,
};

/// Terminal statuses - matches apps/api/src/rides/ride-state-machine.ts's derived
/// TERMINAL_RIDE_STATUSES (every status with no outgoing transition).
const terminalRideStatuses = {
  RideStatus.completed,
  RideStatus.cancelledByUser,
  RideStatus.cancelledByDriver,
  RideStatus.cancelledBySystem,
  RideStatus.noDriverAvailable,
};

/// Lightweight driver/vehicle summary embedded on an assigned ride - mirrors
/// RideDriverSummaryDto (ride-response.dto.ts).
class RideDriverSummary {
  const RideDriverSummary({
    required this.id,
    required this.name,
    required this.mobile,
    required this.driverCode,
  });

  final String id;
  final String name;
  final String mobile;
  final String driverCode;

  factory RideDriverSummary.fromJson(Map<String, dynamic> json) {
    return RideDriverSummary(
      id: json['id'] as String,
      name: json['name'] as String,
      mobile: json['mobile'] as String,
      driverCode: json['driverCode'] as String,
    );
  }
}

/// Mirrors apps/api/src/rides/dto/ride-response.dto.ts's RideResponseDto (plus the
/// driver/vehicleCode enrichment rides.controller.ts#enrich adds).
class Ride {
  const Ride({
    required this.id,
    required this.userId,
    required this.driverId,
    required this.vehicleId,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.pickupLocationName,
    required this.destinationLatitude,
    required this.destinationLongitude,
    required this.destinationLocationName,
    required this.status,
    required this.driver,
    required this.vehicleCode,
    required this.requestedAt,
    required this.acceptedAt,
    required this.driverArrivedAt,
    required this.startedAt,
    required this.completedAt,
    required this.cancelledAt,
  });

  final String id;
  final String userId;
  final String? driverId;
  final String? vehicleId;
  final double pickupLatitude;
  final double pickupLongitude;
  final String? pickupLocationName;
  final double destinationLatitude;
  final double destinationLongitude;
  final String? destinationLocationName;
  final RideStatus status;
  final RideDriverSummary? driver;
  final String? vehicleCode;
  final DateTime requestedAt;
  final DateTime? acceptedAt;
  final DateTime? driverArrivedAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? cancelledAt;

  bool get isActive => activeRideStatuses.contains(status);
  bool get isTerminal => terminalRideStatuses.contains(status);

  factory Ride.fromJson(Map<String, dynamic> json) {
    return Ride(
      id: json['id'] as String,
      userId: json['userId'] as String,
      driverId: json['driverId'] as String?,
      vehicleId: json['vehicleId'] as String?,
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      pickupLocationName: json['pickupLocationName'] as String?,
      destinationLatitude: (json['destinationLatitude'] as num).toDouble(),
      destinationLongitude: (json['destinationLongitude'] as num).toDouble(),
      destinationLocationName: json['destinationLocationName'] as String?,
      status: rideStatusFromWire(json['status'] as String),
      driver: json['driver'] != null
          ? RideDriverSummary.fromJson(json['driver'] as Map<String, dynamic>)
          : null,
      vehicleCode: json['vehicleCode'] as String?,
      requestedAt: DateTime.parse(json['requestedAt'] as String),
      acceptedAt: _parseNullable(json['acceptedAt']),
      driverArrivedAt: _parseNullable(json['driverArrivedAt']),
      startedAt: _parseNullable(json['startedAt']),
      completedAt: _parseNullable(json['completedAt']),
      cancelledAt: _parseNullable(json['cancelledAt']),
    );
  }
}

DateTime? _parseNullable(dynamic value) => value == null ? null : DateTime.parse(value as String);

/// Which booking-flow screen shows a ride at [status], or null for a terminal status (nothing
/// to resume into - see Ride Details/history instead). Used both by each screen's own forward
/// navigation and by HomeScreen's "resume active ride" banner (app restarted mid-ride).
String? routeForRideStatus(RideStatus status) {
  switch (status) {
    case RideStatus.requested:
    case RideStatus.searchingDriver:
      return '/finding-vehicle';
    case RideStatus.driverAssigned:
    case RideStatus.driverEnRouteToPickup:
    case RideStatus.driverArrived:
      return '/driver-en-route';
    case RideStatus.rideStarted:
    case RideStatus.driverEnRouteToDestination:
      return '/on-the-way';
    case RideStatus.noDriverAvailable:
      return '/finding-vehicle';
    case RideStatus.completed:
    case RideStatus.cancelledByUser:
    case RideStatus.cancelledByDriver:
    case RideStatus.cancelledBySystem:
      return null;
  }
}

/// Mirrors apps/api/src/drivers/dto/driver-response.dto.ts's availability enum. `busy` is
/// never self-set by the driver (drivers.controller.ts's UpdateAvailabilityDto only allows
/// OFFLINE/AVAILABLE/ON_BREAK) - it's implied by having an active ride (assignment.service.ts
/// sets it on accept), so this app derives it rather than ever sending it.
enum DriverAvailability { offline, available, onBreak, busy }

const _availabilityByWireName = {
  'OFFLINE': DriverAvailability.offline,
  'AVAILABLE': DriverAvailability.available,
  'ON_BREAK': DriverAvailability.onBreak,
  'BUSY': DriverAvailability.busy,
};

const _wireNameByAvailability = {
  DriverAvailability.offline: 'OFFLINE',
  DriverAvailability.available: 'AVAILABLE',
  DriverAvailability.onBreak: 'ON_BREAK',
  DriverAvailability.busy: 'BUSY',
};

DriverAvailability driverAvailabilityFromWire(String value) {
  final availability = _availabilityByWireName[value];
  if (availability == null) {
    throw ArgumentError('Unknown driver availability from backend: $value');
  }
  return availability;
}

String driverAvailabilityToWire(DriverAvailability value) => _wireNameByAvailability[value]!;

/// One leg of a pending offer (pickup or destination) - mirrors dispatch.controller.ts's
/// PendingOfferResponse nested shape.
class OfferLocation {
  const OfferLocation({required this.latitude, required this.longitude, this.locationName});

  final double latitude;
  final double longitude;
  final String? locationName;

  factory OfferLocation.fromJson(Map<String, dynamic> json) {
    return OfferLocation(
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      locationName: json['locationName'] as String?,
    );
  }
}

/// Mirrors apps/api/src/dispatch/dispatch.controller.ts's PendingOfferResponse - the shape
/// GET /dispatch/offers/me returns (or null if nothing is pending).
class PendingOffer {
  const PendingOffer({
    required this.offerId,
    required this.rideId,
    required this.offeredAt,
    required this.pickup,
    required this.destination,
  });

  final String offerId;
  final String rideId;
  final DateTime offeredAt;
  final OfferLocation pickup;
  final OfferLocation destination;

  factory PendingOffer.fromJson(Map<String, dynamic> json) {
    return PendingOffer(
      offerId: json['offerId'] as String,
      rideId: json['rideId'] as String,
      offeredAt: DateTime.parse(json['offeredAt'] as String),
      pickup: OfferLocation.fromJson(json['pickup'] as Map<String, dynamic>),
      destination: OfferLocation.fromJson(json['destination'] as Map<String, dynamic>),
    );
  }
}

/// Matches dispatch/dispatch.constants.ts's OFFER_RESPONSE_WINDOW_MS - how long an offer stays
/// PENDING before the backend's own timeout job expires it and re-offers the next driver.
const offerResponseWindow = Duration(seconds: 15);

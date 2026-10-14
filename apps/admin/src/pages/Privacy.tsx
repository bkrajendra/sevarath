export function PrivacyPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#f8f7f2] text-[#10231a]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6 sm:px-8">
        <a href="/download" className="flex items-center gap-3" aria-label="SevaRath home">
          <img src="/sevarath-logo.png" alt="" className="h-16 w-auto object-contain" />
        </a>
      </header>

      <article className="mx-auto w-full max-w-3xl px-5 pb-20 text-base leading-7 text-[#33483a] sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-[#10231a]">
          SevaRath Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-[#718077]">Last updated: 13 October 2026</p>

        <p className="mt-6">
          SevaRath ("the app") is an electric-vehicle ride-booking app for the Shantivan
          (Abu Road) campus community, published by Rajendra Khope. SevaRath has no fare,
          payment, surge pricing, or wallet feature — this policy only concerns the account,
          location, and ride information needed to run the ride itself.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tight text-[#10231a]">
          What we collect
        </h2>
        <ul className="mt-4 list-disc space-y-3 pl-5">
          <li>
            <strong className="text-[#10231a]">Account information:</strong> your name and
            mobile number, which every account requires. Riders may also sign up with an
            email address and password, or sign in with Google (name, email, and Firebase
            Authentication's identifier for your account). Driver accounts are created by a
            campus administrator and sign in with their mobile number/email and password —
            drivers do not use Google Sign-In.
          </li>
          <li>
            <strong className="text-[#10231a]">Location:</strong> while the app is in the
            foreground, we use your device's precise and approximate location to find your
            pickup point, match you with a nearby SevaRath EV, and (for drivers) share your
            live position with the matched rider during a trip. Neither app requests
            background location access — location is not collected while the app is closed
            or backgrounded.
          </li>
          <li>
            <strong className="text-[#10231a]">Push notification token:</strong> Firebase
            Cloud Messaging assigns your device a token, linked to your account, used only
            to deliver ride-status notifications (e.g. "driver arriving", "ride accepted").
          </li>
          <li>
            <strong className="text-[#10231a]">Ride history and ratings:</strong>{' '}
            pickup/destination, timestamps, and status of rides you request or drive; and,
            for riders, the star rating and optional written feedback you leave for a
            completed ride.
          </li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold tracking-tight text-[#10231a]">
          What we don't do
        </h2>
        <ul className="mt-4 list-disc space-y-3 pl-5">
          <li>No advertising, no ad SDKs, no selling or renting any data to third parties.</li>
          <li>No analytics or tracking SDK of any kind.</li>
          <li>
            No payment or financial information is ever collected — the app has no payment
            feature.
          </li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold tracking-tight text-[#10231a]">
          Who can see your data
        </h2>
        <p className="mt-4">
          Your location and ride information are visible to the SevaRath driver or rider
          matched to your active ride, and to campus administrators operating the SevaRath
          service. Your account, location, and ride data is stored and processed on
          SevaRath's own servers — not by a third-party data processor. Two third-party
          services support specific features: Google Firebase handles rider Google Sign-In
          and push-notification delivery (it does not receive your location or ride data),
          Resend delivers account emails (driver-credential and password-reset messages,
          which include your email address), and the OpenFreeMap map service receives your
          device's IP address and the map area you're viewing in order to display map tiles.
          None of these receive your ride history, ratings, or payment information — the
          app has none of the last to share.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tight text-[#10231a]">
          Data retention and deletion
        </h2>
        <p className="mt-4">
          We keep your account and ride history for as long as your SevaRath account is
          active. To request deletion of your account and associated data, email{' '}
          <a href="mailto:bkrajendra@gmail.com" className="text-[#087a43] underline">
            bkrajendra@gmail.com
          </a>{' '}
          with the mobile number or email address on your account.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tight text-[#10231a]">Contact</h2>
        <p className="mt-4">
          Questions about this policy:{' '}
          <a href="mailto:bkrajendra@gmail.com" className="text-[#087a43] underline">
            bkrajendra@gmail.com
          </a>
          .
        </p>
      </article>
    </main>
  );
}

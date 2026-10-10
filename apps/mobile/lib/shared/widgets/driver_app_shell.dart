import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Driver-flavor equivalent of AppShell - 2 tabs (Home, Profile) instead of the rider's 3
/// (Home, Rides, Profile), since there's no driver-side ride history yet.
class DriverAppShell extends StatelessWidget {
  const DriverAppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: navigationShell.currentIndex,
        onTap: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Profile'),
        ],
      ),
    );
  }
}

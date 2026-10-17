import 'package:flutter/material.dart';

class BroadcastTheme {
  // Backgrounds
  static const Color background = Color(0xFF101216);
  static const Color surface = Color(0xFF181B22);
  static const Color card = Color(0xFF20242D);
  static const Color cardBorder = Color(0xFF2C3240);
  static const Color bevelHighlight = Color(0xFF3B4354);
  static const Color bevelShadow = Color(0xFF0A0C0E);

  // Tally & Broadcast Indicators
  static const Color tallyRed = Color(0xFFFF1744);       // Program (PGM) - ON AIR
  static const Color tallyRedGlow = Color(0x66FF1744);
  static const Color tallyGreen = Color(0xFF00E676);     // Preview (PVW)
  static const Color tallyGreenGlow = Color(0x6600E676);
  static const Color tallyAmber = Color(0xFFFF9100);     // Transition / Auto
  static const Color tallyAmberGlow = Color(0x66FF9100);
  static const Color tallyWhite = Color(0xFFCFD8DC);     // Standby / Armed
  
  // Accent & Protocols
  static const Color obsPurple = Color(0xFF9C27B0);
  static const Color ndiCyan = Color(0xFF00E5FF);
  static const Color usbBlue = Color(0xFF2979FF);

  // Text Colors
  static const Color textPrimary = Color(0xFFECEFF1);
  static const Color textSecondary = Color(0xFF90A4AE);
  static const Color textMuted = Color(0xFF546E7A);

  static ThemeData get themeData {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      primaryColor: usbBlue,
      cardColor: card,
      colorScheme: const ColorScheme.dark(
        primary: usbBlue,
        secondary: tallyGreen,
        surface: surface,
        error: tallyRed,
      ),
      fontFamily: 'Inter',
    );
  }
}

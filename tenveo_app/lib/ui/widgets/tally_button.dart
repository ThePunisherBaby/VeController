import 'package:flutter/material.dart';
import '../theme/broadcast_theme.dart';

enum TallyMode {
  none,
  program, // Red (On Air)
  preview, // Green (Armed)
  amber,   // Transition / Active
  ftb,     // Fade to black
}

class TallyButton extends StatefulWidget {
  final String label;
  final String? subLabel;
  final TallyMode mode;
  final VoidCallback onTap;
  final double width;
  final double height;
  final IconData? icon;

  const TallyButton({
    super.key,
    required this.label,
    this.subLabel,
    this.mode = TallyMode.none,
    required this.onTap,
    this.width = 90,
    this.height = 75,
    this.icon,
  });

  @override
  State<TallyButton> createState() => _TallyButtonState();
}

class _TallyButtonState extends State<TallyButton> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    Color glowColor;
    Color borderColor;
    Color buttonColor;
    Color textColor;

    switch (widget.mode) {
      case TallyMode.program:
        glowColor = BroadcastTheme.tallyRedGlow;
        borderColor = BroadcastTheme.tallyRed;
        buttonColor = const Color(0xFF8A0017);
        textColor = Colors.white;
        break;
      case TallyMode.preview:
        glowColor = BroadcastTheme.tallyGreenGlow;
        borderColor = BroadcastTheme.tallyGreen;
        buttonColor = const Color(0xFF005A2A);
        textColor = Colors.white;
        break;
      case TallyMode.amber:
        glowColor = BroadcastTheme.tallyAmberGlow;
        borderColor = BroadcastTheme.tallyAmber;
        buttonColor = const Color(0xFF7A4500);
        textColor = Colors.white;
        break;
      case TallyMode.ftb:
        glowColor = BroadcastTheme.tallyRedGlow;
        borderColor = BroadcastTheme.tallyRed;
        buttonColor = const Color(0xFF5A000F);
        textColor = Colors.white;
        break;
      case TallyMode.none:
        glowColor = Colors.transparent;
        borderColor = BroadcastTheme.cardBorder;
        buttonColor = BroadcastTheme.card;
        textColor = BroadcastTheme.textSecondary;
        break;
    }

    if (_isPressed) {
      buttonColor = buttonColor.withValues(alpha: 0.8);
    }

    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) {
        setState(() => _isPressed = false);
        widget.onTap();
      },
      onTapCancel: () => setState(() => _isPressed = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        width: widget.width,
        height: widget.height,
        transform: _isPressed
            ? Matrix4.diagonal3Values(0.96, 0.96, 1.0)
            : Matrix4.identity(),
        decoration: BoxDecoration(
          color: buttonColor,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: borderColor,
            width: widget.mode != TallyMode.none ? 2.5 : 1.2,
          ),
          boxShadow: [
            if (widget.mode != TallyMode.none)
              BoxShadow(
                color: glowColor,
                blurRadius: 14,
                spreadRadius: 2,
              ),
            const BoxShadow(
              color: Colors.black45,
              offset: Offset(0, 4),
              blurRadius: 6,
            ),
          ],
        ),
        child: Center(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (widget.icon != null) ...[
                    Icon(widget.icon, color: textColor, size: 22),
                    const SizedBox(height: 2),
                  ],
                  Text(
                    widget.label,
                    style: TextStyle(
                      color: textColor,
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.1,
                    ),
                  ),
                  if (widget.subLabel != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      widget.subLabel!,
                      style: TextStyle(
                        color: textColor.withValues(alpha: 0.7),
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import '../theme/broadcast_theme.dart';

class TbarFader extends StatefulWidget {
  final double value; // 0.0 (top/PVW) to 1.0 (bottom/PGM)
  final ValueChanged<double> onChanged;
  final VoidCallback onTransitionComplete;

  const TbarFader({
    super.key,
    required this.value,
    required this.onChanged,
    required this.onTransitionComplete,
  });

  @override
  State<TbarFader> createState() => _TbarFaderState();
}

class _TbarFaderState extends State<TbarFader> {
  double _currentPos = 0.0;

  @override
  void initState() {
    super.initState();
    _currentPos = widget.value;
  }

  @override
  void didUpdateWidget(TbarFader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value) {
      _currentPos = widget.value;
    }
  }

  @override
  Widget build(BuildContext context) {
    const double trackHeight = 180.0;
    const double handleHeight = 36.0;
    const double maxOffset = trackHeight - handleHeight;

    final double topOffset = _currentPos * maxOffset;
    final int percent = (_currentPos * 100).toInt();

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'T-BAR',
          style: TextStyle(
            color: BroadcastTheme.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          width: 70,
          height: trackHeight,
          decoration: BoxDecoration(
            color: const Color(0xFF14171E),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: BroadcastTheme.cardBorder, width: 1.5),
            boxShadow: const [
              BoxShadow(
                color: Colors.black54,
                blurRadius: 4,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: Stack(
            alignment: Alignment.topCenter,
            children: [
              // Track groove
              Positioned(
                top: 10,
                bottom: 10,
                child: Container(
                  width: 6,
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),

              // Draggable T-Bar Handle
              Positioned(
                top: topOffset,
                child: GestureDetector(
                  onVerticalDragUpdate: (details) {
                    setState(() {
                      _currentPos = (_currentPos + details.delta.dy / maxOffset)
                          .clamp(0.0, 1.0);
                    });
                    widget.onChanged(_currentPos);
                  },
                  onVerticalDragEnd: (_) {
                    if (_currentPos > 0.95 || _currentPos < 0.05) {
                      widget.onTransitionComplete();
                    }
                  },
                  child: Container(
                    width: 58,
                    height: handleHeight,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF4A5263), Color(0xFF262A34)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: _currentPos > 0.0 && _currentPos < 1.0
                            ? BroadcastTheme.tallyAmber
                            : BroadcastTheme.bevelHighlight,
                        width: 1.5,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: _currentPos > 0.0 && _currentPos < 1.0
                              ? BroadcastTheme.tallyAmberGlow
                              : Colors.black45,
                          blurRadius: 6,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Center(
                      child: Container(
                        width: 28,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.white70,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '$percent%',
          style: TextStyle(
            color: _currentPos > 0.0 && _currentPos < 1.0
                ? BroadcastTheme.tallyAmber
                : BroadcastTheme.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import '../theme/broadcast_theme.dart';

class AudioFader extends StatelessWidget {
  final String channelName;
  final int valueDb; // typical range: -60 to +6 dB
  final ValueChanged<int> onChanged;
  final bool isMaster;

  const AudioFader({
    super.key,
    required this.channelName,
    required this.valueDb,
    required this.onChanged,
    this.isMaster = false,
  });

  @override
  Widget build(BuildContext context) {
    // Map -60..+6 dB to 0.0..1.0
    final double normalized = ((valueDb + 60) / 66.0).clamp(0.0, 1.0);

    return Container(
      width: 78,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      decoration: BoxDecoration(
        color: isMaster ? const Color(0xFF1F1824) : BroadcastTheme.card,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isMaster ? BroadcastTheme.obsPurple.withValues(alpha: 0.5) : BroadcastTheme.cardBorder,
          width: 1.2,
        ),
      ),
      child: Column(
        children: [
          Text(
            channelName,
            style: TextStyle(
              color: isMaster ? BroadcastTheme.obsPurple : BroadcastTheme.textPrimary,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            valueDb <= -60 ? '-∞' : '$valueDb dB',
            style: TextStyle(
              color: valueDb > 0 ? BroadcastTheme.tallyRed : BroadcastTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),

          // Slider & VU Meter row
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // VU Meter bar
                Container(
                  width: 6,
                  margin: const EdgeInsets.only(right: 6),
                  decoration: BoxDecoration(
                    color: Colors.black45,
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      height: 120 * normalized,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: [
                            BroadcastTheme.tallyGreen,
                            BroadcastTheme.tallyAmber,
                            BroadcastTheme.tallyRed,
                          ],
                          stops: [0.6, 0.85, 1.0],
                        ),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ),

                // Vertical Slider
                RotatedBox(
                  quarterTurns: 3,
                  child: SliderTheme(
                    data: SliderTheme.of(context).copyWith(
                      trackHeight: 4,
                      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
                      overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                      activeTrackColor: isMaster ? BroadcastTheme.obsPurple : BroadcastTheme.usbBlue,
                      inactiveTrackColor: Colors.black54,
                      thumbColor: Colors.white,
                    ),
                    child: Slider(
                      value: normalized,
                      onChanged: (val) {
                        final newDb = (val * 66.0 - 60).round();
                        onChanged(newDb);
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 6),
          // Mute Button
          GestureDetector(
            onTap: () {
              if (valueDb <= -60) {
                onChanged(-6); // unmute to default -6dB
              } else {
                onChanged(-60); // mute
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: valueDb <= -60 ? BroadcastTheme.tallyRed : const Color(0xFF2C3240),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'MUTE',
                style: TextStyle(
                  color: valueDb <= -60 ? Colors.white : BroadcastTheme.textMuted,
                  fontSize: 9,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

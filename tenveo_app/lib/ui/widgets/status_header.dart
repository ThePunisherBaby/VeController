import 'package:flutter/material.dart';
import '../../models/obs_state.dart';
import '../../models/switcher_state.dart';
import '../theme/broadcast_theme.dart';

class StatusHeader extends StatelessWidget {
  final SwitcherState switcherState;
  final ObsState obsState;
  final bool syncEnabled;
  final VoidCallback onToggleSync;
  final VoidCallback onConfigureIp;
  final VoidCallback onToggleStream;
  final VoidCallback onToggleRecord;
  final VoidCallback onToggleVirtualCam;

  const StatusHeader({
    super.key,
    required this.switcherState,
    required this.obsState,
    required this.syncEnabled,
    required this.onToggleSync,
    required this.onConfigureIp,
    required this.onToggleStream,
    required this.onToggleRecord,
    required this.onToggleVirtualCam,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: BroadcastTheme.surface,
        border: Border(
          bottom: BorderSide(color: BroadcastTheme.cardBorder, width: 1.5),
        ),
      ),
      child: Row(
        children: [
          // Brand & Model
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF2979FF), Color(0xFF1565C0)],
              ),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text(
              'TENVEO PC500',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 13,
                letterSpacing: 1.2,
              ),
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'STUDIO LINK',
            style: TextStyle(
              color: BroadcastTheme.textSecondary,
              fontWeight: FontWeight.w700,
              fontSize: 12,
              letterSpacing: 1.0,
            ),
          ),

          const SizedBox(width: 20),

          // Tenveo PC500 Hardware Status Badge
          InkWell(
            onTap: onConfigureIp,
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: switcherState.isConnected
                    ? const Color(0xFF00381B)
                    : const Color(0xFF331A00),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: switcherState.isConnected
                      ? BroadcastTheme.tallyGreen
                      : BroadcastTheme.tallyAmber,
                  width: 1.2,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: switcherState.isConnected
                          ? BroadcastTheme.tallyGreen
                          : BroadcastTheme.tallyAmber,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    switcherState.isConnected
                        ? 'PC500: ${switcherState.connectionEndpoint}'
                        : 'BUSCANDO PC500 (USB / LAN)...',
                    style: TextStyle(
                      color: switcherState.isConnected
                          ? BroadcastTheme.tallyGreen
                          : BroadcastTheme.tallyAmber,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.settings, size: 14, color: BroadcastTheme.textSecondary),
                ],
              ),
            ),
          ),

          const SizedBox(width: 12),

          // NDI Ready Tag
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFF002A33),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: BroadcastTheme.ndiCyan.withValues(alpha: 0.6)),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.wifi, size: 13, color: BroadcastTheme.ndiCyan),
                SizedBox(width: 5),
                Text(
                  'NDI|HX CERTIFIED',
                  style: TextStyle(
                    color: BroadcastTheme.ndiCyan,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),

          const Spacer(),

          // OBS Sync Switch
          InkWell(
            onTap: onToggleSync,
            borderRadius: BorderRadius.circular(6),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: syncEnabled ? const Color(0xFF2C1636) : BroadcastTheme.card,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: syncEnabled ? BroadcastTheme.obsPurple : BroadcastTheme.cardBorder,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    syncEnabled ? Icons.sync : Icons.sync_disabled,
                    size: 14,
                    color: syncEnabled ? BroadcastTheme.obsPurple : BroadcastTheme.textMuted,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'SYNC OBS',
                    style: TextStyle(
                      color: syncEnabled ? Colors.white : BroadcastTheme.textMuted,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(width: 12),

          // OBS Studio Controls
          _buildObsButton(
            label: 'LIVE',
            isActive: obsState.isStreaming,
            activeColor: BroadcastTheme.tallyRed,
            icon: Icons.cell_tower,
            onTap: onToggleStream,
          ),
          const SizedBox(width: 8),
          _buildObsButton(
            label: 'REC',
            isActive: obsState.isRecording,
            activeColor: BroadcastTheme.tallyRed,
            icon: Icons.fiber_manual_record,
            onTap: onToggleRecord,
          ),
          const SizedBox(width: 8),
          _buildObsButton(
            label: 'VCAM',
            isActive: obsState.isVirtualCamActive,
            activeColor: BroadcastTheme.usbBlue,
            icon: Icons.videocam,
            onTap: onToggleVirtualCam,
          ),
        ],
      ),
    );
  }

  Widget _buildObsButton({
    required String label,
    required bool isActive,
    required Color activeColor,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? activeColor : BroadcastTheme.card,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isActive ? Colors.white70 : BroadcastTheme.cardBorder,
          ),
          boxShadow: [
            if (isActive)
              BoxShadow(
                color: activeColor.withValues(alpha: 0.5),
                blurRadius: 8,
              ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 13,
              color: isActive ? Colors.white : BroadcastTheme.textSecondary,
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                color: isActive ? Colors.white : BroadcastTheme.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

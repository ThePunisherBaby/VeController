import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/switcher_provider.dart';
import '../theme/broadcast_theme.dart';
import '../widgets/audio_fader.dart';
import '../widgets/status_header.dart';
import '../widgets/tally_button.dart';
import '../widgets/tbar_fader.dart';

class SwitcherStudioScreen extends StatelessWidget {
  const SwitcherStudioScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SwitcherProvider>();
    final switcherState = provider.switcherState;
    final obsState = provider.obsState;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Top Status Bar
            StatusHeader(
              switcherState: switcherState,
              obsState: obsState,
              syncEnabled: provider.syncWithObs,
              onToggleSync: provider.toggleObsSync,
              onConfigureIp: () => _showIpConfigDialog(context, provider),
              onToggleStream: provider.toggleObsStream,
              onToggleRecord: provider.toggleObsRecord,
              onToggleVirtualCam: provider.toggleObsVirtualCam,
            ),

            // Main Console Workspace
            Expanded(
              child: Row(
                children: [
                  // Left / Center: Video Monitors + Switcher Buses (70%)
                  Expanded(
                    flex: 7,
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Top: Dual Program / Preview Monitors
                          Expanded(
                            flex: 4,
                            child: Row(
                              children: [
                                // PREVIEW MONITOR (PVW - Green)
                                Expanded(
                                  child: _buildMonitorCard(
                                    title: 'PREVIEW (PVW)',
                                    cameraLabel: _getCameraName(switcherState.pvwCamera),
                                    accentColor: BroadcastTheme.tallyGreen,
                                    glowColor: BroadcastTheme.tallyGreenGlow,
                                    badgeText: 'ARMED',
                                    isProgram: false,
                                  ),
                                ),
                                const SizedBox(width: 16),
                                // PROGRAM MONITOR (PGM - Red)
                                Expanded(
                                  child: _buildMonitorCard(
                                    title: 'PROGRAM (PGM)',
                                    cameraLabel: _getCameraName(switcherState.pgmCamera),
                                    accentColor: BroadcastTheme.tallyRed,
                                    glowColor: BroadcastTheme.tallyRedGlow,
                                    badgeText: 'LIVE ON AIR',
                                    isProgram: true,
                                  ),
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: 16),

                          // Bottom: Broadcast Switcher Deck & Controls
                          Expanded(
                            flex: 5,
                            child: Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: BroadcastTheme.surface,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: BroadcastTheme.cardBorder,
                                  width: 1.5,
                                ),
                              ),
                              child: Row(
                                children: [
                                  // Switcher Buses (PGM & PVW)
                                  Expanded(
                                    child: SingleChildScrollView(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          // --- PROGRAM BUS (RED) ---
                                          _buildBusRow(
                                            title: 'PROGRAM (DIRECT ON AIR)',
                                            titleColor: BroadcastTheme.tallyRed,
                                            activeCam: switcherState.pgmCamera,
                                            isProgramBus: true,
                                            onSelect: (cam) => provider.switchLive(cam),
                                          ),

                                          const Divider(
                                            color: BroadcastTheme.cardBorder,
                                            height: 20,
                                            thickness: 1,
                                          ),

                                          // --- PREVIEW BUS (GREEN) ---
                                          _buildBusRow(
                                            title: 'PREVIEW (NEXT TRANSITION)',
                                            titleColor: BroadcastTheme.tallyGreen,
                                            activeCam: switcherState.pvwCamera,
                                            isProgramBus: false,
                                            onSelect: (cam) => provider.selectPreviewCamera(cam),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),

                                  const SizedBox(width: 20),

                                  // Vertical separator
                                  Container(
                                    width: 1.5,
                                    color: BroadcastTheme.cardBorder,
                                    margin: const EdgeInsets.symmetric(horizontal: 4),
                                  ),

                                  const SizedBox(width: 20),

                                  // Transition Control: CUT, AUTO, FTB, T-Bar
                                  Row(
                                    children: [
                                      // Action buttons column
                                      Column(
                                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                        children: [
                                          TallyButton(
                                            label: 'CUT',
                                            subLabel: 'DIRECT',
                                            mode: switcherState.isCut ? TallyMode.program : TallyMode.none,
                                            width: 85,
                                            height: 52,
                                            onTap: provider.cut,
                                          ),
                                          TallyButton(
                                            label: 'AUTO',
                                            subLabel: 'TRANS',
                                            mode: switcherState.isAuto ? TallyMode.amber : TallyMode.none,
                                            width: 85,
                                            height: 52,
                                            onTap: provider.auto,
                                          ),
                                          TallyButton(
                                            label: 'FTB',
                                            subLabel: 'BLACK',
                                            mode: switcherState.isFtb ? TallyMode.ftb : TallyMode.none,
                                            width: 85,
                                            height: 48,
                                            onTap: provider.ftb,
                                          ),
                                        ],
                                      ),

                                      const SizedBox(width: 18),

                                      // T-Bar Fader
                                      TbarFader(
                                        value: switcherState.tbarPosition,
                                        onChanged: provider.setTbarPosition,
                                        onTransitionComplete: provider.cut,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Right Section: Audio Mixer & OBS Panel (30%)
                  Container(
                    width: 320,
                    margin: const EdgeInsets.only(top: 16, bottom: 16, right: 16),
                    decoration: BoxDecoration(
                      color: BroadcastTheme.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: BroadcastTheme.cardBorder,
                        width: 1.5,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Audio Mixer Header
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                          child: Row(
                            children: [
                              const Icon(Icons.equalizer, size: 16, color: BroadcastTheme.usbBlue),
                              const SizedBox(width: 6),
                              const Expanded(
                                child: Text(
                                  'AUDIO MIXER',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.8,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF1E2838),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  '48 kHz USB',
                                  style: TextStyle(
                                    color: BroadcastTheme.usbBlue,
                                    fontSize: 9,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),

                        // Horizontal Scrollable Audio Faders
                        Expanded(
                          flex: 5,
                          child: ListView(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            children: [
                              AudioFader(
                                channelName: 'IN 1',
                                valueDb: switcherState.audioVolumes['in1'] ?? -6,
                                onChanged: (v) => provider.setVolume('in1', v),
                              ),
                              const SizedBox(width: 6),
                              AudioFader(
                                channelName: 'IN 2',
                                valueDb: switcherState.audioVolumes['in2'] ?? -6,
                                onChanged: (v) => provider.setVolume('in2', v),
                              ),
                              const SizedBox(width: 6),
                              AudioFader(
                                channelName: 'IN 3',
                                valueDb: switcherState.audioVolumes['in3'] ?? -6,
                                onChanged: (v) => provider.setVolume('in3', v),
                              ),
                              const SizedBox(width: 6),
                              AudioFader(
                                channelName: 'IN 4',
                                valueDb: switcherState.audioVolumes['in4'] ?? -6,
                                onChanged: (v) => provider.setVolume('in4', v),
                              ),
                              const SizedBox(width: 6),
                              AudioFader(
                                channelName: 'MIC 1',
                                valueDb: switcherState.audioVolumes['mic1'] ?? 0,
                                onChanged: (v) => provider.setVolume('mic1', v),
                              ),
                              const SizedBox(width: 6),
                              AudioFader(
                                channelName: 'PGM OUT',
                                valueDb: switcherState.audioVolumes['pgm'] ?? -6,
                                isMaster: true,
                                onChanged: (v) => provider.setVolume('pgm', v),
                              ),
                            ],
                          ),
                        ),

                        const Divider(color: BroadcastTheme.cardBorder, height: 1),

                        // OBS Studio Scenes List
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                          child: Row(
                            children: [
                              const Icon(Icons.layers, size: 16, color: BroadcastTheme.obsPurple),
                              const SizedBox(width: 8),
                              const Text(
                                'OBS SCENES',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 1.0,
                                ),
                              ),
                              const Spacer(),
                              Text(
                                obsState.isConnected ? 'LINKED' : 'OFFLINE',
                                style: TextStyle(
                                  color: obsState.isConnected
                                      ? BroadcastTheme.tallyGreen
                                      : BroadcastTheme.textMuted,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),

                        Expanded(
                          flex: 4,
                          child: ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            itemCount: obsState.scenes.length,
                            itemBuilder: (context, index) {
                              final scene = obsState.scenes[index];
                              final isCurrent = scene == obsState.currentProgramScene;

                              return Container(
                                margin: const EdgeInsets.only(bottom: 6),
                                child: InkWell(
                                  onTap: () => provider.selectObsScene(scene),
                                  borderRadius: BorderRadius.circular(6),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: isCurrent
                                          ? BroadcastTheme.obsPurple.withValues(alpha: 0.3)
                                          : BroadcastTheme.card,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(
                                        color: isCurrent
                                            ? BroadcastTheme.obsPurple
                                            : BroadcastTheme.cardBorder,
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        Icon(
                                          isCurrent ? Icons.radio_button_checked : Icons.radio_button_off,
                                          size: 14,
                                          color: isCurrent ? BroadcastTheme.obsPurple : BroadcastTheme.textMuted,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            scene,
                                            style: TextStyle(
                                              color: isCurrent ? Colors.white : BroadcastTheme.textPrimary,
                                              fontSize: 12,
                                              fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                                            ),
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBusRow({
    required String title,
    required Color titleColor,
    required String activeCam,
    required bool isProgramBus,
    required ValueChanged<String> onSelect,
  }) {
    final cams = [
      {'id': '1', 'name': 'CAM 1', 'sub': 'HDMI 1'},
      {'id': '2', 'name': 'CAM 2', 'sub': 'HDMI 2'},
      {'id': '3', 'name': 'CAM 3', 'sub': 'SDI 1'},
      {'id': '4', 'name': 'CAM 4', 'sub': 'SDI 2'},
      {'id': 'aux', 'name': 'AUX', 'sub': 'MEDIA / NDI'},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: titleColor,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: titleColor,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.1,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 12,
          runSpacing: 10,
          children: cams.map((cam) {
            final isSelected = cam['id'] == activeCam;
            final mode = isSelected
                ? (isProgramBus ? TallyMode.program : TallyMode.preview)
                : TallyMode.none;

            return TallyButton(
              label: cam['name']!,
              subLabel: cam['sub'],
              mode: mode,
              width: 88,
              height: 62,
              onTap: () => onSelect(cam['id']!),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildMonitorCard({
    required String title,
    required String cameraLabel,
    required Color accentColor,
    required Color glowColor,
    required String badgeText,
    required bool isProgram,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accentColor, width: 2),
        boxShadow: [
          BoxShadow(
            color: glowColor,
            blurRadius: 16,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Stack(
        children: [
          // Background raster grid / placeholder
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.videocam_outlined,
                  size: 48,
                  color: accentColor.withValues(alpha: 0.3),
                ),
                const SizedBox(height: 8),
                Text(
                  cameraLabel,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.5,
                  ),
                ),
                Text(
                  '1080p60 USB & ETHERNET NDI FEED',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.4),
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),

          // Top Header Bar
          Positioned(
            top: 10,
            left: 12,
            right: 12,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      color: accentColor,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.2,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: accentColor,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    badgeText,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _getCameraName(String cam) {
    switch (cam) {
      case '1':
        return 'CAMERA 1 (HDMI 1)';
      case '2':
        return 'CAMERA 2 (HDMI 2)';
      case '3':
        return 'CAMERA 3 (SDI 1)';
      case '4':
        return 'CAMERA 4 (SDI 2)';
      case 'aux':
        return 'AUX (MEDIA / NDI)';
      default:
        return 'CAMERA $cam';
    }
  }

  void _showIpConfigDialog(BuildContext context, SwitcherProvider provider) {
    final controller = TextEditingController(text: provider.manualEthernetIp);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BroadcastTheme.surface,
        title: const Text('Conexión Tenveo PC500 (Plug & Play)'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'El software detecta automáticamente el PC500 por USB mediante el puente ADB local. Si prefieres conectarlo por Ethernet (LAN), ingresa su dirección IP:',
              style: TextStyle(fontSize: 12, color: BroadcastTheme.textSecondary),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'IP Ethernet del PC500 (ej. 192.168.1.188)',
                border: OutlineInputBorder(),
                hintText: '192.168.1.188',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              provider.retryHardwareConnect();
              Navigator.pop(ctx);
            },
            child: const Text('Auto-Detectar USB'),
          ),
          ElevatedButton(
            onPressed: () {
              provider.setManualEthernetIp(controller.text);
              Navigator.pop(ctx);
            },
            child: const Text('Guardar y Conectar'),
          ),
        ],
      ),
    );
  }
}

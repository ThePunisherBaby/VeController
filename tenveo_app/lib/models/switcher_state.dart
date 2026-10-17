enum ConnectionType {
  disconnected,
  connecting,
  connectedUsb,
  connectedEthernet,
}

class SwitcherState {
  final ConnectionType connectionType;
  final String connectionEndpoint;
  final String? lastError;

  // Selected cameras
  final String pgmCamera; // "1", "2", "3", "4", "aux"
  final String pvwCamera; // "1", "2", "3", "4", "aux"

  // Transition & Flags
  final bool isFtb;
  final bool isAuto;
  final bool isCut;
  final double tbarPosition; // 0.0 (PVW) to 1.0 (PGM)

  // Audio volumes (dB)
  final Map<String, int> audioVolumes; // "pgm", "in1", "in2", "in3", "in4", "mic1", "mic2"
  final Map<String, bool> audioMutes;

  // Raw device state map
  final Map<String, dynamic> rawState;

  const SwitcherState({
    this.connectionType = ConnectionType.disconnected,
    this.connectionEndpoint = '',
    this.lastError,
    this.pgmCamera = '1',
    this.pvwCamera = '2',
    this.isFtb = false,
    this.isAuto = false,
    this.isCut = false,
    this.tbarPosition = 0.0,
    this.audioVolumes = const {
      'pgm': -6,
      'in1': -6,
      'in2': -6,
      'in3': -6,
      'in4': -6,
      'mic1': 0,
      'mic2': 0,
    },
    this.audioMutes = const {},
    this.rawState = const {},
  });

  bool get isConnected =>
      connectionType == ConnectionType.connectedUsb ||
      connectionType == ConnectionType.connectedEthernet;

  SwitcherState copyWith({
    ConnectionType? connectionType,
    String? connectionEndpoint,
    String? lastError,
    String? pgmCamera,
    String? pvwCamera,
    bool? isFtb,
    bool? isAuto,
    bool? isCut,
    double? tbarPosition,
    Map<String, int>? audioVolumes,
    Map<String, bool>? audioMutes,
    Map<String, dynamic>? rawState,
  }) {
    return SwitcherState(
      connectionType: connectionType ?? this.connectionType,
      connectionEndpoint: connectionEndpoint ?? this.connectionEndpoint,
      lastError: lastError,
      pgmCamera: pgmCamera ?? this.pgmCamera,
      pvwCamera: pvwCamera ?? this.pvwCamera,
      isFtb: isFtb ?? this.isFtb,
      isAuto: isAuto ?? this.isAuto,
      isCut: isCut ?? this.isCut,
      tbarPosition: tbarPosition ?? this.tbarPosition,
      audioVolumes: audioVolumes ?? this.audioVolumes,
      audioMutes: audioMutes ?? this.audioMutes,
      rawState: rawState ?? this.rawState,
    );
  }
}

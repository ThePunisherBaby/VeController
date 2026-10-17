enum ObsConnectionStatus {
  disconnected,
  connecting,
  connected,
}

class ObsState {
  final ObsConnectionStatus status;
  final bool isStreaming;
  final bool isRecording;
  final bool isVirtualCamActive;
  final String streamTimecode;
  final String recordTimecode;
  final List<String> scenes;
  final String currentProgramScene;
  final String currentPreviewScene;
  final String? lastError;

  const ObsState({
    this.status = ObsConnectionStatus.disconnected,
    this.isStreaming = false,
    this.isRecording = false,
    this.isVirtualCamActive = false,
    this.streamTimecode = '00:00:00',
    this.recordTimecode = '00:00:00',
    this.scenes = const ['PC500 Program', 'Cam 1 Wide', 'Cam 2 Close', 'Slides'],
    this.currentProgramScene = 'PC500 Program',
    this.currentPreviewScene = '',
    this.lastError,
  });

  bool get isConnected => status == ObsConnectionStatus.connected;

  ObsState copyWith({
    ObsConnectionStatus? status,
    bool? isStreaming,
    bool? isRecording,
    bool? isVirtualCamActive,
    String? streamTimecode,
    String? recordTimecode,
    List<String>? scenes,
    String? currentProgramScene,
    String? currentPreviewScene,
    String? lastError,
  }) {
    return ObsState(
      status: status ?? this.status,
      isStreaming: isStreaming ?? this.isStreaming,
      isRecording: isRecording ?? this.isRecording,
      isVirtualCamActive: isVirtualCamActive ?? this.isVirtualCamActive,
      streamTimecode: streamTimecode ?? this.streamTimecode,
      recordTimecode: recordTimecode ?? this.recordTimecode,
      scenes: scenes ?? this.scenes,
      currentProgramScene: currentProgramScene ?? this.currentProgramScene,
      currentPreviewScene: currentPreviewScene ?? this.currentPreviewScene,
      lastError: lastError,
    );
  }
}

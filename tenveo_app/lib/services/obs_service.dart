import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/obs_state.dart';

class ObsService {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;
  bool _isDisposed = false;
  int _rpcId = 1;

  final _stateController = StreamController<ObsState>.broadcast();
  Stream<ObsState> get stateStream => _stateController.stream;

  ObsState _currentState = const ObsState();
  ObsState get currentState => _currentState;

  void dispose() {
    _isDisposed = true;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _stateController.close();
  }

  /// Inicia la conexion a OBS Studio (puerto por defecto: 4455)
  void startConnect({String host = '127.0.0.1', int port = 4455, String? password}) {
    _tryConnect(host, port, password);
  }

  Future<void> _tryConnect(String host, int port, String? password) async {
    if (_isDisposed) return;

    if (_currentState.status != ObsConnectionStatus.connected) {
      _updateState(_currentState.copyWith(
        status: ObsConnectionStatus.connecting,
      ));

      try {
        final uri = Uri.parse('ws://$host:$port');
        final channel = WebSocketChannel.connect(uri);

        await channel.ready.timeout(const Duration(seconds: 2));

        _channel = channel;
        _subscription?.cancel();
        _subscription = _channel!.stream.listen(
          (msg) => _onObsMessage(msg, password),
          onError: (err) {
            debugPrint('[ObsService] Error: $err');
            _onDisconnected();
          },
          onDone: () {
            debugPrint('[ObsService] Closed');
            _onDisconnected();
          },
        );

        debugPrint('[ObsService] Socket abierto a OBS');
      } catch (e) {
        _updateState(_currentState.copyWith(
          status: ObsConnectionStatus.disconnected,
          lastError: e.toString(),
        ));
      }
    }

    if (_isDisposed) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (!_currentState.isConnected && !_isDisposed) {
        _tryConnect(host, port, password);
      }
    });
  }

  void _onObsMessage(dynamic rawMsg, String? password) {
    if (rawMsg is! String) return;
    try {
      final Map<String, dynamic> msg = jsonDecode(rawMsg);
      final int op = msg['op'] ?? -1;
      final d = msg['d'] ?? {};

      // OBS WebSocket Protocol OpCodes:
      // Op 0: Hello (servidor saluda)
      if (op == 0) {
        _sendIdentify(password);
      }
      // Op 2: Identified (autenticado)
      else if (op == 2) {
        _updateState(_currentState.copyWith(
          status: ObsConnectionStatus.connected,
          lastError: null,
        ));
        _queryInitialStatus();
      }
      // Op 5: Event
      else if (op == 5) {
        _handleObsEvent(d['eventType'] ?? '', d['eventData'] ?? {});
      }
      // Op 7: RequestResponse
      else if (op == 7) {
        _handleRequestResponse(d['requestType'] ?? '', d['responseData'] ?? {});
      }
    } catch (e) {
      debugPrint('[ObsService] Error en mensaje OBS: $e');
    }
  }

  void _sendIdentify(String? password) {
    // Op 1: Identify
    final payload = {
      'op': 1,
      'd': {
        'rpcVersion': 1,
        'eventSubscriptions': (1 << 0) | (1 << 2) | (1 << 6), // General, Scenes, Stream/Record
      }
    };
    _send(payload);
  }

  void _queryInitialStatus() {
    _sendRequest('GetStreamStatus');
    _sendRequest('GetRecordStatus');
    _sendRequest('GetVirtualCamStatus');
    _sendRequest('GetSceneList');
  }

  void _handleObsEvent(String eventType, Map<String, dynamic> data) {
    if (eventType == 'StreamStateChanged') {
      _updateState(_currentState.copyWith(
        isStreaming: data['outputActive'] ?? false,
      ));
    } else if (eventType == 'RecordStateChanged') {
      _updateState(_currentState.copyWith(
        isRecording: data['outputActive'] ?? false,
      ));
    } else if (eventType == 'VirtualcamStateChanged') {
      _updateState(_currentState.copyWith(
        isVirtualCamActive: data['outputActive'] ?? false,
      ));
    } else if (eventType == 'CurrentProgramSceneChanged') {
      _updateState(_currentState.copyWith(
        currentProgramScene: data['sceneName'] ?? '',
      ));
    }
  }

  void _handleRequestResponse(String reqType, Map<String, dynamic> data) {
    if (reqType == 'GetStreamStatus') {
      _updateState(_currentState.copyWith(
        isStreaming: data['outputActive'] ?? false,
        streamTimecode: data['outputTimecode'] ?? '00:00:00',
      ));
    } else if (reqType == 'GetRecordStatus') {
      _updateState(_currentState.copyWith(
        isRecording: data['outputActive'] ?? false,
        recordTimecode: data['outputTimecode'] ?? '00:00:00',
      ));
    } else if (reqType == 'GetVirtualCamStatus') {
      _updateState(_currentState.copyWith(
        isVirtualCamActive: data['outputActive'] ?? false,
      ));
    } else if (reqType == 'GetSceneList') {
      final List scenes = data['scenes'] ?? [];
      final sceneNames = scenes.map((s) => s['sceneName'].toString()).toList();
      _updateState(_currentState.copyWith(
        scenes: sceneNames,
        currentProgramScene: data['currentProgramSceneName'] ?? '',
      ));
    }
  }

  void _sendRequest(String requestType, [Map<String, dynamic>? requestData]) {
    final reqId = (_rpcId++).toString();
    final payload = {
      'op': 6,
      'd': {
        'requestType': requestType,
        'requestId': reqId,
        'requestData': ?requestData,
      }
    };
    _send(payload);
  }

  void _send(Map<String, dynamic> data) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(data));
    }
  }

  void _onDisconnected() {
    _subscription?.cancel();
    _channel = null;
    _updateState(_currentState.copyWith(
      status: ObsConnectionStatus.disconnected,
    ));
  }

  void _updateState(ObsState newState) {
    _currentState = newState;
    if (!_stateController.isClosed) {
      _stateController.add(_currentState);
    }
  }

  // --- ACCIONES DE USUARIO EN OBS ---

  void toggleStream() {
    _sendRequest('ToggleStream');
  }

  void toggleRecord() {
    _sendRequest('ToggleRecord');
  }

  void toggleVirtualCam() {
    _sendRequest('ToggleVirtualCam');
  }

  void setScene(String sceneName) {
    _sendRequest('SetCurrentProgramScene', {'sceneName': sceneName});
  }
}

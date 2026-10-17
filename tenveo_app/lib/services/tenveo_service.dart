import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/switcher_state.dart';

class TenveoService {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;
  bool _isDisposed = false;

  final _stateController = StreamController<SwitcherState>.broadcast();
  Stream<SwitcherState> get stateStream => _stateController.stream;

  SwitcherState _currentState = const SwitcherState();
  SwitcherState get currentState => _currentState;

  void dispose() {
    _isDisposed = true;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _stateController.close();
  }

  /// Inicia el bucle de conexion Plug & Play
  void startAutoConnect({String? manualEthernetIp}) {
    _connectLoop(manualEthernetIp);
  }

  Future<void> _connectLoop(String? manualIp) async {
    if (_isDisposed) return;

    if (!_currentState.isConnected) {
      _updateState(_currentState.copyWith(
        connectionType: ConnectionType.connecting,
      ));

      bool connected = false;

      // 1. Intentar conectar por USB via localhost bridge (puerto 8089)
      // En web, el bridge externo (Python/Node) ya hace el adb forward.
      // El usuario solo necesita correr el bridge helper.
      try {
        connected = await _tryConnectUsb();
      } catch (e) {
        debugPrint('[TenveoService] USB bridge connect error: $e');
      }

      // 2. Si no conecto por USB, probar por Ethernet (IP directa)
      if (!connected && manualIp != null && manualIp.isNotEmpty) {
        try {
          connected = await _tryConnectEthernet(manualIp);
        } catch (e) {
          debugPrint('[TenveoService] Ethernet connect error: $e');
        }
      }

      if (!connected) {
        _updateState(_currentState.copyWith(
          connectionType: ConnectionType.disconnected,
        ));
      }
    }

    if (_isDisposed) return;

    // Programar siguiente sondeo de reconexion si se desconecta
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 4), () {
      if (!_currentState.isConnected && !_isDisposed) {
        _connectLoop(manualIp);
      }
    });
  }

  /// Intenta conectar al WebSocket local (bridge USB -> localhost:8089)
  /// En plataforma web, el bridge externo Python/Node se encarga del adb forward.
  Future<bool> _tryConnectUsb() async {
    return _connectToUri(
      Uri.parse('ws://127.0.0.1:8089'),
      ConnectionType.connectedUsb,
      'USB (Bridge: 127.0.0.1:8089)',
    );
  }

  /// Intenta conectar por direccion IP de Ethernet
  Future<bool> _tryConnectEthernet(String ip) async {
    return _connectToUri(
      Uri.parse('ws://$ip:8089'),
      ConnectionType.connectedEthernet,
      'Ethernet LAN ($ip:8089)',
    );
  }

  Future<bool> _connectToUri(
    Uri uri,
    ConnectionType type,
    String endpointName,
  ) async {
    try {
      final channel = WebSocketChannel.connect(uri);
      
      // Esperar brevemente para verificar que la conexion no falle inmediatamente
      await channel.ready.timeout(const Duration(seconds: 2));

      _channel = channel;
      _subscription?.cancel();
      _subscription = _channel!.stream.listen(
        _onMessageReceived,
        onError: (err) {
          debugPrint('[TenveoService] WebSocket error: $err');
          _onDisconnected();
        },
        onDone: () {
          debugPrint('[TenveoService] WebSocket closed');
          _onDisconnected();
        },
      );

      _updateState(_currentState.copyWith(
        connectionType: type,
        connectionEndpoint: endpointName,
        lastError: null,
      ));

      debugPrint('[TenveoService] Conectado exitosamente via $endpointName');
      return true;
    } catch (e) {
      debugPrint('[TenveoService] Fallo conectar a $uri: $e');
      return false;
    }
  }

  void _onMessageReceived(dynamic message) {
    if (message is! String) return;
    try {
      final Map<String, dynamic> data = jsonDecode(message);
      _processDeviceUpdate(data);
    } catch (e) {
      debugPrint('[TenveoService] Error decodificando JSON: $e');
    }
  }

  void _processDeviceUpdate(Map<String, dynamic> data) {
    final updatedRaw = Map<String, dynamic>.from(_currentState.rawState);
    updatedRaw.addAll(data);

    String newPgm = _currentState.pgmCamera;
    String newPvw = _currentState.pvwCamera;
    final updatedVolumes = Map<String, int>.from(_currentState.audioVolumes);

    for (final entry in data.entries) {
      final key = entry.key;
      final val = entry.value;

      // Detectar estado de LEDs de camaras
      // Formato: "pvw-1": "active-red" (PGM) o "active-green" (PVW) o "none-red"
      if (key.startsWith('pvw-')) {
        final camId = key.replaceFirst('pvw-', '');
        if (val is String) {
          if (val.contains('red') && val.contains('active')) {
            newPgm = camId;
          } else if (val.contains('green') && val.contains('active')) {
            newPvw = camId;
          }
        }
      }

      // Detectar volumenes
      if (key.startsWith('audio_') && key.endsWith('_vol') && val is num) {
        final ch = key.replaceFirst('audio_', '').replaceFirst('_vol', '');
        updatedVolumes[ch] = val.toInt();
      }
    }

    _updateState(_currentState.copyWith(
      rawState: updatedRaw,
      pgmCamera: newPgm,
      pvwCamera: newPvw,
      audioVolumes: updatedVolumes,
      isFtb: updatedRaw['ftb'] == 'active-red' || updatedRaw['ftb'] == 1,
      isAuto: updatedRaw['auto'] == 'active-white' || updatedRaw['auto'] == 1,
      isCut: updatedRaw['cut'] == 1,
    ));
  }

  void _onDisconnected() {
    _subscription?.cancel();
    _channel = null;
    _updateState(_currentState.copyWith(
      connectionType: ConnectionType.disconnected,
    ));
    _connectLoop(null);
  }

  void _updateState(SwitcherState newState) {
    _currentState = newState;
    if (!_stateController.isClosed) {
      _stateController.add(_currentState);
    }
  }

  // --- COMANDOS AL HARDWARE ---

  void sendCommand(Map<String, dynamic> cmd) {
    if (_channel != null && _currentState.isConnected) {
      final payload = jsonEncode(cmd);
      _channel!.sink.add(payload);
      debugPrint('[TenveoService] Sent: $payload');
    }
  }

  /// Selecciona una camara en Preview (1, 2, 3, 4, aux)
  void selectCamera(String camera) {
    sendCommand({'pvw-$camera': 1});
  }

  /// Ejecuta transicion CUT directa a Program
  void cut() {
    sendCommand({'cut': 1});
  }

  /// Ejecuta transicion AUTO
  void auto() {
    sendCommand({'auto': 1});
  }

  /// Ejecuta transicion directa de camara (Preview + CUT)
  void switchLive(String camera) {
    selectCamera(camera);
    Future.delayed(const Duration(milliseconds: 150), () {
      cut();
    });
  }

  /// Fade To Black
  void ftb() {
    sendCommand({'ftb': 1});
  }

  /// Ajuste de volumen en dB
  void setAudioVolume(String channel, int volumeDb) {
    sendCommand({'audio_${channel}_vol': volumeDb});
  }
}

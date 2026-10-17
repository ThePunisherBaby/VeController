import 'dart:async';
import 'package:flutter/material.dart';
import '../models/obs_state.dart';
import '../models/switcher_state.dart';
import '../services/obs_service.dart';
import '../services/tenveo_service.dart';

class SwitcherProvider extends ChangeNotifier {
  final TenveoService _tenveoService;
  final ObsService _obsService;

  StreamSubscription? _tenveoSub;
  StreamSubscription? _obsSub;

  SwitcherState _switcherState = const SwitcherState();
  SwitcherState get switcherState => _switcherState;

  ObsState _obsState = const ObsState();
  ObsState get obsState => _obsState;

  bool _syncWithObs = true;
  bool get syncWithObs => _syncWithObs;

  String _manualEthernetIp = '';
  String get manualEthernetIp => _manualEthernetIp;

  SwitcherProvider({
    required this._tenveoService,
    required this._obsService,
    bool autoConnect = true,
  }) {
    _init(autoConnect: autoConnect);
  }

  void _init({bool autoConnect = true}) {
    _tenveoSub = _tenveoService.stateStream.listen((newState) {
      final oldPgm = _switcherState.pgmCamera;
      _switcherState = newState;
      notifyListeners();

      // Si esta activada la sincronizacion con OBS y cambio la camara al aire
      if (_syncWithObs && oldPgm != newState.pgmCamera && _obsState.isConnected) {
        _syncObsScene(newState.pgmCamera);
      }
    });

    _obsSub = _obsService.stateStream.listen((newState) {
      _obsState = newState;
      notifyListeners();
    });

    if (autoConnect) {
      // Iniciar deteccion Plug & Play de hardware
      _tenveoService.startAutoConnect();

      // Iniciar conexion a OBS local
      _obsService.startConnect();
    }
  }

  @override
  void dispose() {
    _tenveoSub?.cancel();
    _obsSub?.cancel();
    _tenveoService.dispose();
    _obsService.dispose();
    super.dispose();
  }

  // --- CONFIGURACION ---

  void toggleObsSync() {
    _syncWithObs = !_syncWithObs;
    notifyListeners();
  }

  void setManualEthernetIp(String ip) {
    _manualEthernetIp = ip.trim();
    _tenveoService.startAutoConnect(manualEthernetIp: _manualEthernetIp);
    notifyListeners();
  }

  void retryHardwareConnect() {
    _tenveoService.startAutoConnect(manualEthernetIp: _manualEthernetIp);
  }

  void retryObsConnect({String host = '127.0.0.1', int port = 4455, String? password}) {
    _obsService.startConnect(host: host, port: port, password: password);
  }

  // --- ACCIONES TENVEO SWITCHER ---

  /// Selecciona camara en Preview (PVW)
  void selectPreviewCamera(String cam) {
    _tenveoService.selectCamera(cam);
  }

  /// Ejecuta corte directo (CUT)
  void cut() {
    _tenveoService.cut();
  }

  /// Ejecuta transicion automatica (AUTO)
  void auto() {
    _tenveoService.auto();
  }

  /// Pasa una camara en vivo directamente (Preview + CUT)
  void switchLive(String cam) {
    _tenveoService.switchLive(cam);
  }

  /// Fade to Black
  void ftb() {
    _tenveoService.ftb();
  }

  /// Ajuste de fader T-Bar manual
  void setTbarPosition(double pos) {
    _switcherState = _switcherState.copyWith(tbarPosition: pos);
    notifyListeners();

    // Si llega a los extremos (0.0 o 1.0), ejecuta el corte
    if (pos >= 0.98 || pos <= 0.02) {
      cut();
    }
  }

  /// Ajuste de volumen
  void setVolume(String channel, int vol) {
    _tenveoService.setAudioVolume(channel, vol);
  }

  // --- ACCIONES OBS ---

  void toggleObsStream() => _obsService.toggleStream();
  void toggleObsRecord() => _obsService.toggleRecord();
  void toggleObsVirtualCam() => _obsService.toggleVirtualCam();

  void selectObsScene(String sceneName) {
    _obsService.setScene(sceneName);
  }

  void _syncObsScene(String camIndex) {
    // Buscar si existe una escena en OBS que coincida con el nombre de la camara
    final match = _obsState.scenes.firstWhere(
      (s) => s.toLowerCase().contains('cam $camIndex') ||
             s.toLowerCase().contains('cam$camIndex') ||
             s.toLowerCase().contains('camera $camIndex'),
      orElse: () => '',
    );
    if (match.isNotEmpty) {
      _obsService.setScene(match);
    }
  }
}

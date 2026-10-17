import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/switcher_provider.dart';
import 'services/obs_service.dart';
import 'services/tenveo_service.dart';
import 'ui/screens/switcher_studio_screen.dart';
import 'ui/theme/broadcast_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const TenveoStudioApp());
}

class TenveoStudioApp extends StatelessWidget {
  final bool autoConnect;
  const TenveoStudioApp({super.key, this.autoConnect = true});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<TenveoService>(
          create: (_) => TenveoService(),
          dispose: (_, service) => service.dispose(),
        ),
        Provider<ObsService>(
          create: (_) => ObsService(),
          dispose: (_, service) => service.dispose(),
        ),
        ChangeNotifierProxyProvider2<TenveoService, ObsService, SwitcherProvider>(
          create: (ctx) => SwitcherProvider(
            tenveoService: ctx.read<TenveoService>(),
            obsService: ctx.read<ObsService>(),
            autoConnect: autoConnect,
          ),
          update: (_, tenveo, obs, previous) =>
              previous ??
              SwitcherProvider(
                tenveoService: tenveo,
                obsService: obs,
                autoConnect: autoConnect,
              ),
        ),
      ],
      child: MaterialApp(
        title: 'Tenveo PC500 Studio Link',
        debugShowCheckedModeBanner: false,
        theme: BroadcastTheme.themeData,
        home: const SwitcherStudioScreen(),
      ),
    );
  }
}

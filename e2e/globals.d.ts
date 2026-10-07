// Page globals the specs reach into from page.evaluate(). The app is vanilla
// JS with module-pattern globals (js/*.js), so there are no types to import.
// Playwright does not type-check; this only keeps editors quiet.
declare const App: any;
declare const FocusManager: any;
declare const Player: any;
declare const LibraryScreen: any;
declare const SonanceUtils: any;
declare const LazyLoader: any;
declare const PerfHud: any;

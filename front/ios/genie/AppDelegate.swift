import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "genie",
      in: window,
      launchOptions: launchOptions
    )

    // Tell iOS we want background fetch events delivered.
    UIApplication.shared.setMinimumBackgroundFetchInterval(UIApplication.backgroundFetchIntervalMinimum)

    // Diagnostics — remove after debugging
    let status = UIApplication.shared.backgroundRefreshStatus
    print("[AppDelegate] backgroundRefreshStatus: \(status.rawValue) (0=restricted 1=denied 2=available)")
    print("[AppDelegate] delegate is self: \(UIApplication.shared.delegate === self)")

    // Forward to expo-task-manager so it can restore previously registered background tasks.
    exTaskManagerAppDelegate()?.application(application, didFinishLaunchingWithOptions: launchOptions)

    return true
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    print("[AppDelegate] ✅ applicationDidEnterBackground called - delegate is self: \(application.delegate === self)")
  }

  // Required for Xcode "Simulate Background Fetch" and real iOS background fetch events.
  // expo-background-fetch uses the legacy UIApplication fetch API, not BGTaskScheduler.
  // @objc dynamic is required — without it Swift won't emit ObjC metadata for this optional
  // protocol method, so UIApplication.delegate.respondsToSelector returns NO and iOS never calls it.
  @objc dynamic func application(
    _ application: UIApplication,
    performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    print("[AppDelegate] ✅ performFetchWithCompletionHandler called")
    let mgr = exTaskManagerAppDelegate()
    print("[AppDelegate] EXTaskManagerAppDelegate: \(mgr != nil ? "found ✅" : "nil ❌")")
    if let mgr = mgr {
      mgr.application(application, performFetchWithCompletionHandler: completionHandler)
    } else {
      completionHandler(.noData)
    }
  }

  private func exTaskManagerAppDelegate() -> EXTaskManagerAppDelegate? {
    return ModuleRegistryProvider.getSingletonModule(for: EXTaskManagerAppDelegate.self) as? EXTaskManagerAppDelegate
  }

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

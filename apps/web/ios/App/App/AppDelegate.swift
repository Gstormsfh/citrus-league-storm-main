import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    // PUSH (2026-09-04 TestFlight audit) — the APNs -> Capacitor bridge.
    //
    // WHY device_tokens HAD ZERO ROWS, EVER. @capacitor/push-notifications
    // does not swizzle the app delegate. Its plugin `load()` only subscribes
    // to two NotificationCenter names and waits
    // (node_modules/@capacitor/push-notifications/ios/Sources/
    //  PushNotificationsPlugin/PushNotificationsPlugin.swift:38-47), and the
    // ONLY thing that ever posts them is the app itself, from here — which is
    // exactly what that package's README tells you to add and what this file
    // was missing.
    //
    // The consequence was invisible from JavaScript. `registerForPush`
    // (apps/web/src/lib/pushNotifications.ts) asked for permission, got it,
    // called PushNotifications.register(), iOS handed the token to
    // `didRegisterForRemoteNotificationsWithDeviceToken` below — and with no
    // implementation the token was dropped on the floor. The 'registration'
    // listener never fired, the 10-second timeout on line 70 of that file
    // resolved null, and the function returned false as if the user had simply
    // declined. Nothing logged, nothing threw, no row was ever written, and
    // PushService therefore had no device to send "you're on the clock" to.
    //
    // Both methods stay total: posting a notification cannot throw, and the
    // failure path is the one the plugin already reports as 'registrationError'.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,
                                        object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                        object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

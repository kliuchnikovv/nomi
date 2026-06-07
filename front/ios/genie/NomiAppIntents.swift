import AppIntents
import UIKit

// Exposes Nomi to the system as an App Shortcut so it can be assigned to the
// iPhone Action Button (Settings → Action Button → Shortcut → "Talk to Nomi")
// or invoked via Siri / the Shortcuts app.
//
// Running the intent foregrounds the app and opens the `nomi://voice` deep link,
// which the React Native side (useVoiceLaunchLink) routes straight into the
// voice conversation screen. Guarded for iOS 16+ (App Intents); the Action
// Button itself requires iOS 17 on iPhone 15 Pro and later. Older OS versions
// simply never see the shortcut, so the app's 15.1 deployment target is unchanged.

@available(iOS 16.0, *)
struct TalkToNomiIntent: AppIntent {
    static var title: LocalizedStringResource = "Talk to Nomi"
    static var description = IntentDescription("Open Nomi and start a voice conversation.")

    // Foreground the app when triggered (required for the voice UI).
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "nomi://voice") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct NomiAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TalkToNomiIntent(),
            phrases: [
                "Talk to \(.applicationName)",
                "Start a voice chat with \(.applicationName)",
            ],
            shortTitle: "Talk to Nomi",
            systemImageName: "mic.fill"
        )
    }
}

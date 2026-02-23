//
//  IOSShortcutsManager.swift
//  Genie
//
//  iOS Shortcuts Manager for SiriKit and Shortcuts app integration
//

import Foundation
import React
import Intents

@objc(IOSShortcutsManager)
class IOSShortcutsManager: NSObject {

    @objc
    func getSirikitShortcuts(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        INVoiceShortcutCenter.shared.getAllVoiceShortcuts { shortcuts, error in
            if let error = error {
                reject("SIRI_ERROR", error.localizedDescription, error)
                return
            }
            let result = (shortcuts ?? []).map { vs -> [String: Any] in
                var info: [String: Any] = [
                    "id": vs.identifier.uuidString,
                    "phrase": vs.invocationPhrase ?? ""
                ]
                if let s = vs.shortcut.intent {
                    info["intentType"] = String(describing: type(of: s))
                } else if let ua = vs.shortcut.userActivity {
                    info["name"] = ua.title ?? ua.activityType
                    info["activityType"] = ua.activityType
                }
                return info
            }
            resolve(result)
        }
    }

    @objc
    func runShortcut(_ name: String,
                     input: String?,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        var components = URLComponents(string: "shortcuts://run-shortcut")!
        var items: [URLQueryItem] = [URLQueryItem(name: "name", value: name)]
        if let input = input, !input.isEmpty {
            items.append(URLQueryItem(name: "input", value: "text"))
            items.append(URLQueryItem(name: "text", value: input))
        }
        components.queryItems = items
        guard let url = components.url else {
            reject("INVALID_URL", "Cannot construct shortcuts:// URL", nil)
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                resolve([
                    "launched": success,
                    "name": name,
                    "url": url.absoluteString
                ])
            }
        }
    }

    @objc
    func donateShortcut(_ name: String,
                        suggestedPhrase: String,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let activityType = "com.genie.shortcut.run"
        let activity = NSUserActivity(activityType: activityType)
        activity.title = name
        activity.suggestedInvocationPhrase = suggestedPhrase
        activity.isEligibleForSearch = true
        activity.isEligibleForPrediction = true
        activity.becomeCurrent()
        resolve([
            "donated": true,
            "name": name,
            "suggestedPhrase": suggestedPhrase
        ])
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return true
    }
}

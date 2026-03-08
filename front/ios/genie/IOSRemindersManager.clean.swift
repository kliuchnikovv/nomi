//  IOSRemindersManager.swift (clean version - without Date extension duplicates)
//  Genie
//
//  iOS Reminders Manager for EventKit integration
//

import Foundation
import React
import EventKit
import UIKit

@objc(IOSRemindersManager)
class IOSRemindersManager: NSObject {

    private let eventStore = EKEventStore()

    override init() {
        super.init()
        requestPermissions()
    }

    private static let souperTasksListName = "SouperTasks"

    private func souperTasksCalendar() -> EKCalendar? {
        if let existing = eventStore.calendars(for: .reminder).first(where: { $0.title == Self.souperTasksListName }) {
            return existing
        }
        let calendar = EKCalendar(for: .reminder, eventStore: eventStore)
        calendar.title = Self.souperTasksListName
        calendar.source = eventStore.defaultCalendarForNewReminders()?.source
            ?? eventStore.sources.first(where: { $0.sourceType == .local })
        do {
            try eventStore.saveCalendar(calendar, commit: true)
            return calendar
        } catch {
            print("[IOSRemindersManager] Failed to create SouperTasks list: \(error)")
            return eventStore.defaultCalendarForNewReminders()
        }
    }

    private func requestPermissions() {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .authorized:
            break
        case .denied, .restricted:
            print("[IOSRemindersManager] Reminders access denied or restricted")
        case .notDetermined:
            eventStore.requestAccess(to: .reminder) { granted, error in
                if !granted {
                    print("[IOSRemindersManager] Reminders access denied")
                }
            }
        @unknown default:
            break
        }
    }

    @objc
    func getReminders(_ list: String, isCompleted: NSNumber?, dueDateStart: String?, dueDateEnd: String?, limit: Int, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .authorized else {
            reject("PERMISSION_DENIED", "Reminders access not authorized", nil)
            return
        }

        let predicate = eventStore.predicateForReminders(in: nil)
        eventStore.fetchReminders(matching: predicate) { reminders in
            guard let reminders = reminders else {
                resolve([])
                return
            }

            var result: [[String: Any]] = []
            let dateFormatter = ISO8601DateFormatter()
            let isCompletedBool = isCompleted?.boolValue

            for reminder in reminders where result.count < limit {
                if let isCompletedBool = isCompletedBool, reminder.isCompleted != isCompletedBool {
                    continue
                }
                if !list.isEmpty, let calendar = reminder.calendar, calendar.calendarIdentifier != list {
                    continue
                }
                if let dueDateStartStr = dueDateStart,
                   let dueDateStart = dateFormatter.date(from: dueDateStartStr),
                   let dueDate = reminder.dueDateComponents?.date {
                    if dueDate < dueDateStart {
                        continue
                    }
                }
                if let dueDateEndStr = dueDateEnd,
                   let dueDateEnd = dateFormatter.date(from: dueDateEndStr),
                   let dueDate = reminder.dueDateComponents?.date {
                    if dueDate > dueDateEnd {
                        continue
                    }
                }

                var reminderData: [String: Any] = [
                    "id": reminder.calendarItemIdentifier,
                    "title": reminder.title ?? "",
                    "isCompleted": reminder.isCompleted,
                    "priority": reminder.priority
                ]

                if let creationDate = reminder.creationDate {
                    reminderData["creationDate"] = creationDate.iso8601String
                }

                if let notes = reminder.notes {
                    reminderData["notes"] = notes
                }

                if let dueDateComponents = reminder.dueDateComponents,
                   let dueDate = dueDateComponents.date {
                    reminderData["dueDate"] = dueDate.iso8601String
                }

                if let calendar = reminder.calendar {
                    reminderData["list"] = calendar.calendarIdentifier
                }

                if let url = reminder.url {
                    reminderData["url"] = url.absoluteString
                }

                if let completionDate = reminder.completionDate {
                    reminderData["completionDate"] = completionDate.iso8601String
                }

                result.append(reminderData)
            }

            resolve(result)
        }
    }

    @objc
    func createReminder(_ title: String, options: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .authorized else {
            reject("PERMISSION_DENIED", "Reminders access not authorized", nil)
            return
        }

        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title
        reminder.isCompleted = false

        if let notes = options["notes"] as? String {
            reminder.notes = notes
        }

        if let dueDateString = options["dueDate"] as? String {
            let dateFormatter = ISO8601DateFormatter()
            if let dueDate = dateFormatter.date(from: dueDateString) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            }
        }

        if let priority = options["priority"] as? Int {
            reminder.priority = priority
        }

        if let urlString = options["url"] as? String, let url = URL(string: urlString) {
            reminder.url = url
        }

        if let calendarId = options["list"] as? String,
           let calendar = eventStore.calendar(withIdentifier: calendarId) {
            reminder.calendar = calendar
        } else {
            reminder.calendar = souperTasksCalendar()
        }

        do {
            try eventStore.save(reminder, commit: true)
            let result: [String: Any] = [
                "id": reminder.calendarItemIdentifier,
                "title": reminder.title ?? "",
                "isCompleted": reminder.isCompleted,
                "priority": reminder.priority
            ]
            resolve(result)
        } catch {
            reject("CREATE_FAILED", "Failed to create reminder", error)
        }
    }

    @objc
    func updateReminder(_ id: String, updates: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .authorized else {
            reject("PERMISSION_DENIED", "Reminders access not authorized", nil)
            return
        }

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            reject("NOT_FOUND", "Reminder not found", nil)
            return
        }

        if let title = updates["title"] as? String {
            reminder.title = title
        }

        if let notes = updates["notes"] as? String {
            reminder.notes = notes
        }

        if let dueDateString = updates["dueDate"] as? String {
            let dateFormatter = ISO8601DateFormatter()
            if let dueDate = dateFormatter.date(from: dueDateString) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            }
        }

        if let isCompleted = updates["isCompleted"] as? Bool {
            reminder.isCompleted = isCompleted
            if isCompleted {
                reminder.completionDate = Date()
            }
        }

        if let priority = updates["priority"] as? Int {
            reminder.priority = priority
        }

        if let urlString = updates["url"] as? String, let url = URL(string: urlString) {
            reminder.url = url
        }

        do {
            try eventStore.save(reminder, commit: true)
            let result: [String: Any] = [
                "id": reminder.calendarItemIdentifier,
                "title": reminder.title ?? "",
                "isCompleted": reminder.isCompleted,
                "priority": reminder.priority
            ]
            resolve(result)
        } catch {
            reject("UPDATE_FAILED", "Failed to update reminder", error)
        }
    }

    @objc
    func deleteReminder(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .authorized else {
            reject("PERMISSION_DENIED", "Reminders access not authorized", nil)
            return
        }

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            reject("NOT_FOUND", "Reminder not found", nil)
            return
        }

        do {
            try eventStore.remove(reminder, commit: true)
            resolve(nil)
        } catch {
            reject("DELETE_FAILED", "Failed to delete reminder", error)
        }
    }

    @objc
    func getLists(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .authorized else {
            reject("PERMISSION_DENIED", "Reminders access not authorized", nil)
            return
        }

        let calendars = eventStore.calendars(for: .reminder)
        let result = calendars.map { calendar in
            var calendarData: [String: Any] = [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "type": calendar.type.rawValue
            ]

            if let cgColor = calendar.cgColor,
               let components = cgColor.components, components.count >= 3 {
                calendarData["color"] = String(format: "#%02X%02X%02X",
                    Int(components[0]) * 255,
                    Int(components[1]) * 255,
                    Int(components[2]) * 255)
            }

            return calendarData
        }

        resolve(result)
    }

    @objc
    func checkPermissionStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        switch status {
        case .authorized:
            resolve("authorized")
        case .denied, .restricted:
            resolve("denied")
        case .notDetermined:
            resolve("notDetermined")
        @unknown default:
            resolve("notDetermined")
        }
    }

    @objc
    func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        eventStore.requestAccess(to: .reminder) { granted, error in
            if let error = error {
                reject("PERMISSION_ERROR", error.localizedDescription, error)
            } else {
                resolve(granted)
            }
        }
    }

    @objc
    func openSettings(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
            resolve(nil)
        } else {
            reject("OPEN_FAILED", "Failed to open settings", nil)
        }
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
}

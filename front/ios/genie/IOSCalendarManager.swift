//
//  IOSCalendarManager.swift
//  Genie
//
//  iOS Calendar Manager for EventKit integration
//

import Foundation
import React
import EventKit

@objc(IOSCalendarManager)
class IOSCalendarManager: NSObject {

    private let eventStore = EKEventStore()

    override init() {
        super.init()
        requestPermissions()
    }

    private func requestPermissions() {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .authorized:
            break
        case .denied, .restricted:
            print("[IOSCalendarManager] Calendar access denied or restricted")
        case .notDetermined:
            eventStore.requestAccess(to: .event) { granted, error in
                if !granted {
                    print("[IOSCalendarManager] Calendar access denied")
                }
            }
        @unknown default:
            break
        }
    }

    @objc
    func getEvents(_ startDate: String, _ endDate: String, _ limit: Int, _ calendar: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .event) == .authorized else {
            reject("PERMISSION_DENIED", "Calendar access not authorized", nil)
            return
        }

        let dateFormatter = ISO8601DateFormatter()
        guard let start = dateFormatter.date(from: startDate),
              let end = dateFormatter.date(from: endDate) else {
            reject("INVALID_DATE", "Invalid date format. Use ISO8601 format.", nil)
            return
        }

        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }

        var result: [[String: Any]] = []
        for event in events.prefix(limit) {
            var eventData: [String: Any] = [
                "id": event.eventIdentifier,
                "title": event.title ?? "",
                "start": event.startDate.iso8601String,
                "end": event.endDate.iso8601String,
                "allDay": event.isAllDay,
                "status": event.status.rawValue
            ]

            if let location = event.location {
                eventData["location"] = location
            }
            if let notes = event.notes {
                eventData["notes"] = notes
            }
            if let url = event.url {
                eventData["url"] = url.absoluteString
            }
            if let calendar = event.calendar {
                eventData["calendar"] = calendar.calendarIdentifier
            }

            result.append(eventData)
        }

        resolve(result)
    }

    @objc
    func createEvent(_ title: String, _ start: String, _ end: String, _ options: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .event) == .authorized else {
            reject("PERMISSION_DENIED", "Calendar access not authorized", nil)
            return
        }

        let dateFormatter = ISO8601DateFormatter()
        guard let startDate = dateFormatter.date(from: start),
              let endDate = dateFormatter.date(from: end) else {
            reject("INVALID_DATE", "Invalid date format. Use ISO8601 format.", nil)
            return
        }

        let event = EKEvent(eventStore: eventStore)
        event.title = title
        event.startDate = startDate
        event.endDate = endDate
        event.isAllDay = options["allDay"] as? Bool ?? false

        if let location = options["location"] as? String {
            event.location = location
        }
        if let notes = options["notes"] as? String {
            event.notes = notes
        }
        if let urlString = options["url"] as? String, let url = URL(string: urlString) {
            event.url = url
        }
        if let calendarId = options["calendar"] as? String,
           let calendar = eventStore.calendar(withIdentifier: calendarId) {
            event.calendar = calendar
        } else {
            event.calendar = eventStore.defaultCalendarForNewEvents
        }

        do {
            try eventStore.save(event, span: .thisEvent)
            let result: [String: Any] = [
                "id": event.eventIdentifier,
                "title": event.title ?? "",
                "start": event.startDate.iso8601String,
                "end": event.endDate.iso8601String,
                "allDay": event.isAllDay
            ]
            resolve(result)
        } catch {
            reject("CREATE_FAILED", "Failed to create event", error)
        }
    }

    @objc
    func updateEvent(_ id: String, _ updates: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .event) == .authorized else {
            reject("PERMISSION_DENIED", "Calendar access not authorized", nil)
            return
        }

        guard let event = eventStore.event(withIdentifier: id) else {
            reject("NOT_FOUND", "Event not found", nil)
            return
        }

        if let title = updates["title"] as? String {
            event.title = title
        }
        if let start = updates["start"] as? String {
            let dateFormatter = ISO8601DateFormatter()
            if let date = dateFormatter.date(from: start) {
                event.startDate = date
            }
        }
        if let end = updates["end"] as? String {
            let dateFormatter = ISO8601DateFormatter()
            if let date = dateFormatter.date(from: end) {
                event.endDate = date
            }
        }
        if let allDay = updates["allDay"] as? Bool {
            event.isAllDay = allDay
        }
        if let location = updates["location"] as? String {
            event.location = location
        }
        if let notes = updates["notes"] as? String {
            event.notes = notes
        }
        if let urlString = updates["url"] as? String, let url = URL(string: urlString) {
            event.url = url
        }

        do {
            try eventStore.save(event, span: .thisEvent)
            let result: [String: Any] = [
                "id": event.eventIdentifier,
                "title": event.title ?? "",
                "start": event.startDate.iso8601String,
                "end": event.endDate.iso8601String,
                "allDay": event.isAllDay
            ]
            resolve(result)
        } catch {
            reject("UPDATE_FAILED", "Failed to update event", error)
        }
    }

    @objc
    func deleteEvent(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .event) == .authorized else {
            reject("PERMISSION_DENIED", "Calendar access not authorized", nil)
            return
        }

        guard let event = eventStore.event(withIdentifier: id) else {
            reject("NOT_FOUND", "Event not found", nil)
            return
        }

        do {
            try eventStore.remove(event, span: .thisEvent)
            resolve(nil)
        } catch {
            reject("DELETE_FAILED", "Failed to delete event", error)
        }
    }

    @objc
    func getCalendars(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard EKEventStore.authorizationStatus(for: .event) == .authorized else {
            reject("PERMISSION_DENIED", "Calendar access not authorized", nil)
            return
        }

        let calendars = eventStore.calendars(for: .event)
        let result = calendars.map { calendar in
            var calendarData: [String: Any] = [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "type": calendar.type.rawValue,
                "source": calendar.source.sourceIdentifier
            ]
            if let cgColor = calendar.cgColor,
               let components = cgColor.components, components.count >= 3 {
                calendarData["color"] = String(format: "#%02X%02X%02X",
                    Int(components[0] * 255),
                    Int(components[1] * 255),
                    Int(components[2] * 255))
            }
            return calendarData
        }

        resolve(result)
    }
}

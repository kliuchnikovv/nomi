//
//  IOSCalendarManager.swift
//  Nomi
//
//  iOS Calendar Manager for EventKit integration
//

import Foundation
import React
import EventKit

@objc(IOSCalendarManager)
class IOSCalendarManager: NSObject {

    private let eventStore = EKEventStore()

    // Request calendar access and call completion with success/failure.
    // Handles iOS 17+ full-access API and pre-iOS 17 fallback.
    private func requestAccess(completion: @escaping (Bool, Error?) -> Void) {
        let status = EKEventStore.authorizationStatus(for: .event)
        switch status {
        case .authorized:
            completion(true, nil)
        case .denied, .restricted:
            completion(false, nil)
        case .notDetermined:
            if #available(iOS 17.0, *) {
                eventStore.requestFullAccessToEvents(completion: completion)
            } else {
                eventStore.requestAccess(to: .event, completion: completion)
            }
        @unknown default:
            // For any future statuses (e.g. writeOnly on iOS 17), try to request.
            if #available(iOS 17.0, *) {
                eventStore.requestFullAccessToEvents(completion: completion)
            } else {
                completion(false, nil)
            }
        }
    }

    // Parse an ISO8601 date string that may or may not have a timezone suffix.
    private func parseDate(_ string: String) -> Date? {
        let formatters: [ISO8601DateFormatter] = [
            // Full internet datetime with optional fractional seconds
            { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }(),
            // Standard internet datetime (most common: "2026-05-27T00:00:00Z")
            ISO8601DateFormatter(),
            // Date + time, no timezone — treat as local
            { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime, .withDashSeparatorInDate]; return f }(),
            // Date only — treat as start of day local
            { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate, .withDashSeparatorInDate]; return f }(),
        ]
        for formatter in formatters {
            if let date = formatter.date(from: string) { return date }
        }
        return nil
    }

    @objc
    func getEvents(_ startDate: String, endDate endDateStr: String, limit: Int, calendar calendarName: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestAccess { [weak self] granted, error in
            guard let self = self else { return }
            guard granted else {
                reject("PERMISSION_DENIED", "Calendar access not authorized", error)
                return
            }

            guard let start = self.parseDate(startDate),
                  let end = self.parseDate(endDateStr) else {
                reject("INVALID_DATE", "Invalid date format. Use ISO8601 format.", nil)
                return
            }

            let predicate = self.eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
            let events = self.eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }

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

                if let location = event.location { eventData["location"] = location }
                if let notes = event.notes { eventData["notes"] = notes }
                if let url = event.url { eventData["url"] = url.absoluteString }
                if let calendar = event.calendar { eventData["calendar"] = calendar.calendarIdentifier }

                result.append(eventData)
            }

            resolve(result)
        }
    }

    @objc
    func createEvent(_ title: String, start startStr: String, end endStr: String, options: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestAccess { [weak self] granted, error in
            guard let self = self else { return }
            guard granted else {
                reject("PERMISSION_DENIED", "Calendar access not authorized", error)
                return
            }

            guard let startDate = self.parseDate(startStr),
                  let endDate = self.parseDate(endStr) else {
                reject("INVALID_DATE", "Invalid date format. Use ISO8601 format.", nil)
                return
            }

            let event = EKEvent(eventStore: self.eventStore)
            event.title = title
            event.startDate = startDate
            event.endDate = endDate
            event.isAllDay = options["allDay"] as? Bool ?? false

            if let location = options["location"] as? String { event.location = location }
            if let notes = options["notes"] as? String { event.notes = notes }
            if let urlString = options["url"] as? String, let url = URL(string: urlString) { event.url = url }
            if let calendarId = options["calendar"] as? String,
               let calendar = self.eventStore.calendar(withIdentifier: calendarId) {
                event.calendar = calendar
            } else {
                event.calendar = self.eventStore.defaultCalendarForNewEvents
            }

            do {
                try self.eventStore.save(event, span: .thisEvent)
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
    }

    @objc
    func updateEvent(_ id: String, updates: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestAccess { [weak self] granted, error in
            guard let self = self else { return }
            guard granted else {
                reject("PERMISSION_DENIED", "Calendar access not authorized", error)
                return
            }

            guard let event = self.eventStore.event(withIdentifier: id) else {
                reject("NOT_FOUND", "Event not found", nil)
                return
            }

            if let title = updates["title"] as? String { event.title = title }
            if let start = updates["start"] as? String, let date = self.parseDate(start) { event.startDate = date }
            if let end = updates["end"] as? String, let date = self.parseDate(end) { event.endDate = date }
            if let allDay = updates["allDay"] as? Bool { event.isAllDay = allDay }
            if let location = updates["location"] as? String { event.location = location }
            if let notes = updates["notes"] as? String { event.notes = notes }
            if let urlString = updates["url"] as? String, let url = URL(string: urlString) { event.url = url }

            do {
                try self.eventStore.save(event, span: .thisEvent)
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
    }

    @objc
    func deleteEvent(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestAccess { [weak self] granted, error in
            guard let self = self else { return }
            guard granted else {
                reject("PERMISSION_DENIED", "Calendar access not authorized", error)
                return
            }

            guard let event = self.eventStore.event(withIdentifier: id) else {
                reject("NOT_FOUND", "Event not found", nil)
                return
            }

            do {
                try self.eventStore.remove(event, span: .thisEvent)
                resolve(nil)
            } catch {
                reject("DELETE_FAILED", "Failed to delete event", error)
            }
        }
    }

    @objc
    func getCalendars(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestAccess { [weak self] granted, error in
            guard let self = self else { return }
            guard granted else {
                reject("PERMISSION_DENIED", "Calendar access not authorized", error)
                return
            }

            let calendars = self.eventStore.calendars(for: .event)
            let result = calendars.map { calendar -> [String: Any] in
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
}

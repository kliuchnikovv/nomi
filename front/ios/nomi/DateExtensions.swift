//
//  DateExtensions.swift
//  Nomi
//
//  Shared Date extensions used across all native modules
//

import Foundation

extension Date {
    var iso8601String: String {
        return ISO8601DateFormatter().string(from: self)
    }
}

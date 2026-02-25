//
//  IOSMailManager.swift
//  Genie
//
//  IMAP/SMTP Email Manager for universal email integration
//

import Foundation
import React
import Network

// MARK: - Configuration Types

@objc(IOSMailManager)
class IOSMailManager: NSObject {

    // MARK: - IMAP Connection Management

    private var imapConnections: [String: NWConnection] = [:]
    private var imapQueues: [String: DispatchQueue] = [:]

    private func getIMAPConnectionKey(host: String, port: UInt16) -> String {
        return "\(host):\(port)"
    }

    private func createIMAPConnection(host: String, port: UInt16, useTLS: Bool) -> NWConnection {
        let key = getIMAPConnectionKey(host: host, port: port)
        let queue = DispatchQueue(label: "com.genie.imap.\(key)")

        if let existingConnection = imapConnections[key] {
            return existingConnection
        }

        var connection: NWConnection
        if useTLS {
            connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tls)
        } else {
            connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("[IOSMailManager] IMAP connection ready: \(host):\(port)")
            case .failed(let error):
                print("[IOSMailManager] IMAP connection failed: \(error)")
            case .waiting(let error):
                print("[IOSMailManager] IMAP connection waiting: \(error)")
            default:
                break
            }
        }

        connection.start(queue: queue)
        imapConnections[key] = connection
        imapQueues[key] = queue

        return connection
    }

    private func closeIMAPConnection(host: String, port: UInt16) {
        let key = getIMAPConnectionKey(host: host, port: port)
        imapConnections[key]?.cancel()
        imapConnections.removeValue(forKey: key)
        imapQueues.removeValue(forKey: key)
    }

    private func sendIMAPCommand(connection: NWConnection, command: String, queue: DispatchQueue) async throws -> String {
        return try await withCheckedThrowingContinuation { continuation in
            var receivedData = Data()
            let commandData = "\(command)\r\n".data(using: .utf8)!

            connection.send(content: commandData, completion: .contentProcessed { error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, context, isComplete, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }

                    if let data = data {
                        receivedData.append(data)
                    }

                    if isComplete || receivedData.count > 0 {
                        let response = String(data: receivedData, encoding: .utf8) ?? ""
                        continuation.resume(returning: response)
                    }
                }
            })
        }
    }

    // MARK: - IMAP Methods

    @objc
    func testConnection(_ config: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                // Wait for connection
                try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second

                // Read greeting
                let greeting = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                // Login
                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                let loginResponse = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                if loginResponse.contains("OK") {
                    // Logout
                    _ = try? await sendIMAPCommand(connection: connection, command: "a002 LOGOUT", queue: queue)
                    resolve(["success": true, "message": "Connection successful"])
                } else {
                    reject("LOGIN_FAILED", "IMAP login failed", nil)
                }

                closeIMAPConnection(host: imapHost, port: imapPort)
            } catch {
                reject("CONNECTION_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func listMailboxes(_ config: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let listCommand = "a002 LIST \"\" \"*\""
                let listResponse = try await sendIMAPCommand(connection: connection, command: listCommand, queue: queue)

                _ = try await sendIMAPCommand(connection: connection, command: "a003 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                let mailboxes = parseMailboxes(from: listResponse)
                resolve(mailboxes)
            } catch {
                reject("LIST_ERROR", error.localizedDescription, error)
            }
        }
    }

    private func parseMailboxes(from response: String) -> [[String: String]] {
        var mailboxes: [[String: String]] = []
        let lines = response.components(separatedBy: "\r\n")

        for line in lines {
            if line.contains("LIST") {
                if let match = line.range(of: "\\([^)]+\\)\\s*\"?([^\"]+)\"?\\s*\"?([^\"]+)\"?", options: .regularExpression) {
                    let substring = String(line[match])
                    let parts = substring.components(separatedBy: "\"").filter { !$0.isEmpty }
                    if parts.count >= 2 {
                        let mailboxName = parts.last ?? ""
                        if !mailboxName.isEmpty {
                            mailboxes.append(["name": mailboxName])
                        }
                    }
                }
            }
        }

        return mailboxes
    }

    @objc
    func fetchEmails(_ config: NSDictionary,
                      mailbox: String,
                      limit: NSInteger,
                      sinceUid: NSInteger,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let searchCommand = sinceUid > 0
                    ? "a003 SEARCH UID \(sinceUid + 1):*"
                    : "a003 SEARCH ALL"

                let searchResponse = try await sendIMAPCommand(connection: connection, command: searchCommand, queue: queue)
                let uids = parseUIDs(from: searchResponse)

                let fetchLimit = min(limit, uids.count)
                let fetchUIDs = Array(uids.suffix(fetchLimit))

                var emails: [[String: Any]] = []
                for uid in fetchUIDs {
                    let fetchCommand = "a004 FETCH \(uid) (UID ENVELOPE FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])"
                    let fetchResponse = try await sendIMAPCommand(connection: connection, command: fetchCommand, queue: queue)

                    if let email = parseEmail(from: fetchResponse, uid: uid, mailbox: mailbox) {
                        emails.append(email)
                    }
                }

                _ = try await sendIMAPCommand(connection: connection, command: "a005 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                resolve(emails)
            } catch {
                reject("FETCH_ERROR", error.localizedDescription, error)
            }
        }
    }

    private func parseUIDs(from response: String) -> [Int] {
        var uids: [Int] = []
        let lines = response.components(separatedBy: "\r\n")

        for line in lines {
            if line.contains("SEARCH") {
                let parts = line.components(separatedBy: " ").filter { !$0.isEmpty }
                for part in parts {
                    if part != "SEARCH" && part != "OK", let uid = Int(part) {
                        uids.append(uid)
                    }
                }
            }
        }

        return uids
    }

    private func parseEmail(from response: String, uid: Int, mailbox: String) -> [String: Any]? {
        var email: [String: Any] = [
            "uid": uid,
            "mailbox": mailbox,
            "flags": []
        ]

        let lines = response.components(separatedBy: "\r\n")

        for line in lines {
            if line.contains("FLAGS") {
                if let match = line.range(of: "FLAGS\\s+\\(([^)]+)\\)", options: .regularExpression) {
                    let flagsString = String(line[match]).replacingOccurrences(of: "FLAGS", with: "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
                    email["flags"] = flagsString.components(separatedBy: " ").map { $0.trimmingCharacters(in: CharacterSet.alphanumerics.inverted) }
                }
            } else if line.contains("INTERNALDATE") {
                if let match = line.range(of: "INTERNALDATE\\s+\"([^\"]+)\"", options: .regularExpression) {
                    let dateString = String(line[match]).replacingOccurrences(of: "INTERNALDATE", with: "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
                    email["date"] = dateString
                }
            } else if line.contains("ENVELOPE") {
                email["subject"] = parseSubject(from: line)
                email["from"] = parseAddress(from: line, field: "FROM")
                email["to"] = parseAddressList(from: line, field: "TO")
            }
        }

        return email
    }

    private func parseSubject(from line: String) -> String {
        if let match = line.range(of: "SUBJECT\\s+\"([^\"]+)\"", options: .regularExpression) {
            let subject = String(line[match]).replacingOccurrences(of: "SUBJECT", with: "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
            return subject
        }
        return ""
    }

    private func parseAddress(from line: String, field: String) -> String {
        if let match = line.range(of: "\(field)\\s+\"([^\"]+)\"", options: .regularExpression) {
            return String(line[match]).replacingOccurrences(of: field, with: "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
        }
        return ""
    }

    private func parseAddressList(from line: String, field: String) -> [String] {
        var addresses: [String] = []
        if let match = line.range(of: "\(field)\\s+\\(([^)]+)\\)", options: .regularExpression) {
            let addressString = String(line[match]).replacingOccurrences(of: field, with: "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
            addresses = addressString.components(separatedBy: " ").map { $0.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters)) }
        }
        return addresses
    }

    @objc
    func fetchEmailBody(_ config: NSDictionary,
                        mailbox: String,
                        uid: NSInteger,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let fetchCommand = "a003 FETCH \(uid) (BODY[])"
                let fetchResponse = try await sendIMAPCommand(connection: connection, command: fetchCommand, queue: queue)

                _ = try await sendIMAPCommand(connection: connection, command: "a004 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                let body = parseEmailBody(from: fetchResponse)
                resolve(["uid": uid, "body": body])
            } catch {
                reject("FETCH_BODY_ERROR", error.localizedDescription, error)
            }
        }
    }

    private func parseEmailBody(from response: String) -> String {
        var body = ""
        var inBody = false

        for line in response.components(separatedBy: "\r\n") {
            if line.contains("FETCH") || line.contains("BODY[]") {
                inBody = true
                continue
            }

            if inBody && line == ")" {
                break
            }

            if inBody {
                body += line + "\r\n"
            }
        }

        return body.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @objc
    func deleteEmail(_ config: NSDictionary,
                      mailbox: String,
                      uid: NSInteger,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let storeCommand = "a003 STORE \(uid) +FLAGS (\\Deleted)"
                _ = try await sendIMAPCommand(connection: connection, command: storeCommand, queue: queue)

                let expungeCommand = "a004 EXPUNGE"
                _ = try await sendIMAPCommand(connection: connection, command: expungeCommand, queue: queue)

                _ = try await sendIMAPCommand(connection: connection, command: "a005 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                resolve(["success": true, "uid": uid])
            } catch {
                reject("DELETE_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func setFlags(_ config: NSDictionary,
                  mailbox: String,
                  uid: NSInteger,
                  flags: NSString,
                  remove: Bool,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let operation = remove ? "-FLAGS" : "+FLAGS"
                let storeCommand = "a003 STORE \(uid) \(operation) (\(flags))"
                _ = try await sendIMAPCommand(connection: connection, command: storeCommand, queue: queue)

                _ = try await sendIMAPCommand(connection: connection, command: "a004 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                resolve(["success": true, "uid": uid, "flags": flags])
            } catch {
                reject("SET_FLAGS_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func moveEmail(_ config: NSDictionary,
                    mailbox: String,
                    uid: NSInteger,
                    destinationMailbox: NSString,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let copyCommand = "a003 COPY \(uid) \"\(destinationMailbox)\""
                let copyResponse = try await sendIMAPCommand(connection: connection, command: copyCommand, queue: queue)

                if copyResponse.contains("OK") {
                    let storeCommand = "a004 STORE \(uid) +FLAGS (\\Deleted)"
                    _ = try await sendIMAPCommand(connection: connection, command: storeCommand, queue: queue)

                    let expungeCommand = "a005 EXPUNGE"
                    _ = try await sendIMAPCommand(connection: connection, command: expungeCommand, queue: queue)
                }

                _ = try await sendIMAPCommand(connection: connection, command: "a006 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                resolve(["success": true, "uid": uid, "destinationMailbox": destinationMailbox])
            } catch {
                reject("MOVE_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func searchMailbox(_ config: NSDictionary,
                       mailbox: String,
                       searchCriteria: NSString,
                       limit: NSInteger,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let imapHost = config["imapHost"] as? String,
              let imapPort = config["imapPort"] as? UInt16,
              let imapUseTLS = config["imapUseTLS"] as? Bool,
              let username = config["username"] as? String,
              let password = config["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil)
            return
        }

        Task {
            do {
                let connection = createIMAPConnection(host: imapHost, port: imapPort, useTLS: imapUseTLS)
                let key = getIMAPConnectionKey(host: imapHost, port: imapPort)
                guard let queue = imapQueues[key] else {
                    throw NSError(domain: "IMAP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Queue not found"])
                }

                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try await sendIMAPCommand(connection: connection, command: "", queue: queue)

                let loginCommand = "a001 LOGIN \"\(username)\" \"\(password)\""
                _ = try await sendIMAPCommand(connection: connection, command: loginCommand, queue: queue)

                let selectCommand = "a002 SELECT \"\(mailbox)\""
                _ = try await sendIMAPCommand(connection: connection, command: selectCommand, queue: queue)

                let searchCommand = "a003 SEARCH \(searchCriteria)"
                let searchResponse = try await sendIMAPCommand(connection: connection, command: searchCommand, queue: queue)

                let uids = parseUIDs(from: searchResponse)
                let fetchLimit = min(limit, uids.count)
                let fetchUIDs = Array(uids.suffix(fetchLimit))

                var emails: [[String: Any]] = []
                for uid in fetchUIDs {
                    let fetchCommand = "a004 FETCH \(uid) (UID ENVELOPE FLAGS INTERNALDATE)"
                    let fetchResponse = try await sendIMAPCommand(connection: connection, command: fetchCommand, queue: queue)

                    if let email = parseEmail(from: fetchResponse, uid: uid, mailbox: mailbox) {
                        emails.append(email)
                    }
                }

                _ = try await sendIMAPCommand(connection: connection, command: "a005 LOGOUT", queue: queue)
                closeIMAPConnection(host: imapHost, port: imapPort)

                resolve(emails)
            } catch {
                reject("SEARCH_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - SMTP Methods

    @objc
    func sendEmail(_ smtpConfig: NSDictionary,
                   message: NSDictionary,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let smtpHost = smtpConfig["smtpHost"] as? String,
              let smtpPort = smtpConfig["smtpPort"] as? UInt16,
              let smtpUseTLS = smtpConfig["smtpUseTLS"] as? Bool,
              let username = smtpConfig["username"] as? String,
              let password = smtpConfig["password"] as? String else {
            reject("INVALID_CONFIG", "Missing required SMTP configuration", nil)
            return
        }

        guard let to = message["to"] as? String,
              let subject = message["subject"] as? String,
              let body = message["body"] as? String else {
            reject("INVALID_MESSAGE", "Missing required message fields", nil)
            return
        }

        let from = message["from"] as? String ?? username

        Task {
            do {
                var connection: NWConnection
                if smtpUseTLS {
                    connection = NWConnection(host: NWEndpoint.Host(smtpHost), port: NWEndpoint.Port(rawValue: smtpPort)!, using: .tls)
                } else {
                    connection = NWConnection(host: NWEndpoint.Host(smtpHost), port: NWEndpoint.Port(rawValue: smtpPort)!, using: .tcp)
                }

                let queue = DispatchQueue(label: "com.genie.smtp.\(smtpHost):\(smtpPort)")
                connection.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        print("[IOSMailManager] SMTP connection ready")
                    case .failed(let error):
                        print("[IOSMailManager] SMTP connection failed: \(error)")
                    default:
                        break
                    }
                }

                connection.start(queue: queue)

                try await Task.sleep(nanoseconds: 1_000_000_000)

                func sendSMTP(_ command: String) async throws -> String {
                    return try await withCheckedThrowingContinuation { continuation in
                        var receivedData = Data()
                        let commandData = "\(command)\r\n".data(using: .utf8)!

                        connection.send(content: commandData, completion: .contentProcessed { error in
                            if let error = error {
                                continuation.resume(throwing: error)
                                return
                            }

                            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, error in
                                if let error = error {
                                    continuation.resume(throwing: error)
                                    return
                                }

                                if let data = data {
                                    receivedData.append(data)
                                }

                                let response = String(data: receivedData, encoding: .utf8) ?? ""
                                continuation.resume(returning: response)
                            }
                        })
                    }
                }

                _ = try await sendSMTP("EHLO localhost")

                let authString = "\0\(username)\0\(password)"
                let authBase64 = authString.data(using: .utf8)?.base64EncodedString() ?? ""
                let authResponse = try await sendSMTP("AUTH PLAIN \(authBase64)")

                guard authResponse.contains("235") else {
                    throw NSError(domain: "SMTP", code: -1, userInfo: [NSLocalizedDescriptionKey: "Authentication failed"])
                }

                let fromCmd = "MAIL FROM:<\(from)>"
                _ = try await sendSMTP(fromCmd)

                let toCmd = "RCPT TO:<\(to)>"
                _ = try await sendSMTP(toCmd)

                _ = try await sendSMTP("DATA")

                let emailContent = [
                    "From: \(from)",
                    "To: \(to)",
                    "Subject: \(subject)",
                    "Date: \(Date().description)",
                    "",
                    body
                ].joined(separator: "\r\n")

                let dataResponse = try await sendSMTP("\(emailContent)\r\n.")

                if dataResponse.contains("250") {
                    _ = try await sendSMTP("QUIT")
                    resolve(["success": true, "message": "Email sent successfully"])
                } else {
                    reject("SEND_ERROR", "Failed to send email", nil)
                }

                connection.cancel()
            } catch {
                reject("SMTP_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return true
    }
}

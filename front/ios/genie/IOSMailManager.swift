//
//  IOSMailManager.swift
//  Genie
//
//  IMAP/SMTP Email Manager for universal email integration
//

import Foundation
import React
import Network

@objc(IOSMailManager)
class IOSMailManager: NSObject {

    // MARK: - Connection helpers

    private func makeConnection(host: String, port: UInt16, useTLS: Bool) -> (NWConnection, DispatchQueue) {
        let queue = DispatchQueue(label: "com.genie.imap.\(host):\(port).\(UUID().uuidString)")
        let conn = NWConnection(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port)!,
            using: useTLS ? .tls : .tcp
        )
        conn.start(queue: queue)
        return (conn, queue)
    }

    /// Await NWConnection reaching .ready; throws on .failed or timeout.
    private func waitForReady(_ conn: NWConnection, timeout: TimeInterval = 10) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            var done = false
            let lock = NSLock()

            let timer = DispatchWorkItem {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                conn.stateUpdateHandler = nil
                cont.resume(throwing: NSError(domain: "IMAP", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Connection timed out after \(timeout)s"]))
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)

            conn.stateUpdateHandler = { state in
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                switch state {
                case .ready:
                    done = true
                    timer.cancel()
                    conn.stateUpdateHandler = nil
                    cont.resume()
                case .failed(let err):
                    done = true
                    timer.cancel()
                    conn.stateUpdateHandler = nil
                    cont.resume(throwing: err)
                default:
                    break
                }
            }
        }
    }

    /// Read the IMAP greeting banner (untagged * OK ...).
    private func readBanner(_ conn: NWConnection) async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            var done = false
            let lock = NSLock()

            let timer = DispatchWorkItem {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                cont.resume(throwing: NSError(domain: "IMAP", code: -4,
                    userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for server greeting"]))
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 8, execute: timer)

            conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, err in
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                timer.cancel()
                if let err = err {
                    cont.resume(throwing: err)
                } else {
                    cont.resume(returning: data.flatMap { String(data: $0, encoding: .utf8) } ?? "")
                }
            }
        }
    }

    /// Send one IMAP command and accumulate the complete tagged response.
    private func sendCommand(_ cmd: String, tag: String, conn: NWConnection) async throws -> String {
        // Send the command line
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let line = "\(tag) \(cmd)\r\n"
            conn.send(content: Data(line.utf8), completion: .contentProcessed { err in
                if let err = err { cont.resume(throwing: err) } else { cont.resume() }
            })
        }
        // Accumulate until we see the tagged completion line
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            var buf = ""
            var done = false
            let lock = NSLock()

            let timer = DispatchWorkItem {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                // Return whatever arrived so far rather than throwing — callers check content
                cont.resume(returning: buf)
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: timer)

            func readChunk() {
                conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isEOF, err in
                    lock.lock(); defer { lock.unlock() }
                    guard !done else { return }

                    if let err = err {
                        done = true; timer.cancel()
                        cont.resume(throwing: err)
                        return
                    }
                    if let data = data, let chunk = String(data: data, encoding: .utf8) {
                        buf += chunk
                    }
                    // Tagged response line signals completion
                    let finished = buf.components(separatedBy: "\r\n").contains {
                        $0.hasPrefix("\(tag) OK") || $0.hasPrefix("\(tag) NO") || $0.hasPrefix("\(tag) BAD")
                    }
                    if finished || isEOF {
                        done = true; timer.cancel()
                        cont.resume(returning: buf)
                    } else {
                        readChunk()
                    }
                }
            }
            readChunk()
        }
    }

    // MARK: - Config extraction helpers

    private func extractIMAPConfig(_ config: NSDictionary) -> (host: String, port: UInt16, tls: Bool, user: String, pass: String)? {
        guard let host = config["imapHost"] as? String,
              let portNum = config["imapPort"] as? NSNumber,
              let user = config["username"] as? String,
              let pass = config["password"] as? String else { return nil }
        let tls = (config["imapUseTLS"] as? Bool) ?? (config["imapUseTLS"] as? NSNumber)?.boolValue ?? true
        return (host, portNum.uint16Value, tls, user, pass)
    }

    // MARK: - IMAP methods

    @objc
    func testConnection(_ config: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                let resp = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                if resp.contains("a001 OK") {
                    _ = try? await sendCommand("LOGOUT", tag: "a002", conn: conn)
                    resolve(["success": true, "message": "Connection successful"])
                } else {
                    reject("LOGIN_FAILED", "IMAP login failed", nil)
                }
            } catch {
                reject("CONNECTION_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func listMailboxes(_ config: NSDictionary,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                let resp = try await sendCommand("LIST \"\" \"*\"", tag: "a002", conn: conn)
                _ = try? await sendCommand("LOGOUT", tag: "a003", conn: conn)
                resolve(parseMailboxes(from: resp))
            } catch {
                reject("LIST_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func fetchEmails(_ config: NSDictionary,
                     mailbox: String,
                     limit: NSInteger,
                     sinceUid: NSInteger,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                let searchCmd = sinceUid > 0 ? "SEARCH UID \(sinceUid + 1):*" : "SEARCH ALL"
                let searchResp = try await sendCommand(searchCmd, tag: "a003", conn: conn)
                let uids = parseUIDs(from: searchResp)
                let fetchUIDs = Array(uids.suffix(min(limit, uids.count)))
                var emails: [[String: Any]] = []
                var seq = 4
                for uid in fetchUIDs {
                    let tag = String(format: "a%03d", seq); seq += 1
                    let resp = try await sendCommand(
                        "FETCH \(uid) (UID ENVELOPE FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])",
                        tag: tag, conn: conn)
                    if let e = parseEmail(from: resp, uid: uid, mailbox: mailbox) { emails.append(e) }
                }
                _ = try? await sendCommand("LOGOUT", tag: String(format: "a%03d", seq), conn: conn)
                resolve(emails)
            } catch {
                reject("FETCH_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func fetchEmailBody(_ config: NSDictionary,
                        mailbox: String,
                        uid: NSInteger,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                let resp = try await sendCommand("FETCH \(uid) (BODY[])", tag: "a003", conn: conn)
                _ = try? await sendCommand("LOGOUT", tag: "a004", conn: conn)
                resolve(["uid": uid, "body": parseEmailBody(from: resp)])
            } catch {
                reject("FETCH_BODY_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc
    func deleteEmail(_ config: NSDictionary,
                     mailbox: String,
                     uid: NSInteger,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                _ = try await sendCommand("STORE \(uid) +FLAGS (\\Deleted)", tag: "a003", conn: conn)
                _ = try await sendCommand("EXPUNGE", tag: "a004", conn: conn)
                _ = try? await sendCommand("LOGOUT", tag: "a005", conn: conn)
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
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                let op = remove ? "-FLAGS" : "+FLAGS"
                _ = try await sendCommand("STORE \(uid) \(op) (\(flags))", tag: "a003", conn: conn)
                _ = try? await sendCommand("LOGOUT", tag: "a004", conn: conn)
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
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                let copyResp = try await sendCommand("COPY \(uid) \"\(destinationMailbox)\"", tag: "a003", conn: conn)
                if copyResp.contains("a003 OK") {
                    _ = try await sendCommand("STORE \(uid) +FLAGS (\\Deleted)", tag: "a004", conn: conn)
                    _ = try await sendCommand("EXPUNGE", tag: "a005", conn: conn)
                }
                _ = try? await sendCommand("LOGOUT", tag: "a006", conn: conn)
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
        guard let c = extractIMAPConfig(config) else {
            reject("INVALID_CONFIG", "Missing required IMAP configuration", nil); return
        }
        Task {
            let (conn, _) = makeConnection(host: c.host, port: c.port, useTLS: c.tls)
            defer { conn.cancel() }
            do {
                try await waitForReady(conn)
                _ = try await readBanner(conn)
                _ = try await sendCommand("LOGIN \"\(c.user)\" \"\(c.pass)\"", tag: "a001", conn: conn)
                _ = try await sendCommand("SELECT \"\(mailbox)\"", tag: "a002", conn: conn)
                let searchResp = try await sendCommand("SEARCH \(searchCriteria)", tag: "a003", conn: conn)
                let uids = parseUIDs(from: searchResp)
                let fetchUIDs = Array(uids.suffix(min(limit, uids.count)))
                var emails: [[String: Any]] = []
                var seq = 4
                for uid in fetchUIDs {
                    let tag = String(format: "a%03d", seq); seq += 1
                    let resp = try await sendCommand(
                        "FETCH \(uid) (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])",
                        tag: tag, conn: conn)
                    if let e = parseEmail(from: resp, uid: uid, mailbox: mailbox) { emails.append(e) }
                }
                _ = try? await sendCommand("LOGOUT", tag: String(format: "a%03d", seq), conn: conn)
                resolve(emails)
            } catch {
                reject("SEARCH_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - SMTP

    @objc
    func sendEmail(_ smtpConfig: NSDictionary,
                   message: NSDictionary,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let host = smtpConfig["smtpHost"] as? String,
              let portNum = smtpConfig["smtpPort"] as? NSNumber,
              let user = smtpConfig["username"] as? String,
              let pass = smtpConfig["password"] as? String,
              let to = message["to"] as? String,
              let subject = message["subject"] as? String,
              let body = message["body"] as? String else {
            reject("INVALID_CONFIG", "Missing required SMTP/message fields", nil); return
        }
        let tls = (smtpConfig["smtpUseTLS"] as? Bool) ?? (smtpConfig["smtpUseTLS"] as? NSNumber)?.boolValue ?? true
        let port = portNum.uint16Value
        let from = message["from"] as? String ?? user

        Task {
            let queue = DispatchQueue(label: "com.genie.smtp.\(host):\(port)")
            let conn = NWConnection(host: NWEndpoint.Host(host),
                                    port: NWEndpoint.Port(rawValue: port)!,
                                    using: tls ? .tls : .tcp)
            conn.start(queue: queue)
            defer { conn.cancel() }

            do {
                try await waitForReady(conn)

                func smtpSend(_ cmd: String) async throws -> String {
                    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
                        conn.send(content: Data("\(cmd)\r\n".utf8), completion: .contentProcessed { err in
                            if let err = err { cont.resume(throwing: err); return }
                            conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, err in
                                if let err = err { cont.resume(throwing: err); return }
                                cont.resume(returning: data.flatMap { String(data: $0, encoding: .utf8) } ?? "")
                            }
                        })
                    }
                }

                _ = try await smtpSend("EHLO localhost")
                let authBase64 = Data("\0\(user)\0\(pass)".utf8).base64EncodedString()
                let authResp = try await smtpSend("AUTH PLAIN \(authBase64)")
                guard authResp.contains("235") else {
                    throw NSError(domain: "SMTP", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: "Authentication failed"])
                }
                _ = try await smtpSend("MAIL FROM:<\(from)>")
                _ = try await smtpSend("RCPT TO:<\(to)>")
                _ = try await smtpSend("DATA")
                let content = "From: \(from)\r\nTo: \(to)\r\nSubject: \(subject)\r\nDate: \(Date())\r\n\r\n\(body)\r\n."
                let dataResp = try await smtpSend(content)
                if dataResp.contains("250") {
                    _ = try? await smtpSend("QUIT")
                    resolve(["success": true, "message": "Email sent successfully"])
                } else {
                    reject("SEND_ERROR", "Failed to send email", nil)
                }
            } catch {
                reject("SMTP_ERROR", error.localizedDescription, error)
            }
        }
    }

    // MARK: - Parsing helpers

    private func parseMailboxes(from response: String) -> [[String: String]] {
        response.components(separatedBy: "\r\n").compactMap { line -> [String: String]? in
            guard line.contains("LIST") else { return nil }
            let parts = line.components(separatedBy: "\"").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            guard let name = parts.last, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return ["name": name.trimmingCharacters(in: .whitespaces)]
        }
    }

    private func parseUIDs(from response: String) -> [Int] {
        var uids: [Int] = []
        for line in response.components(separatedBy: "\r\n") {
            guard line.contains("SEARCH") else { continue }
            for part in line.components(separatedBy: " ") where part != "SEARCH" && part != "OK" && part != "*" {
                if let uid = Int(part) { uids.append(uid) }
            }
        }
        return uids
    }

    private func parseEmail(from response: String, uid: Int, mailbox: String) -> [String: Any]? {
        var email: [String: Any] = [
            "uid": uid, "mailbox": mailbox, "flags": [String](),
            "subject": "", "from": "", "to": [String](), "date": "",
        ]
        let lines = response.components(separatedBy: "\r\n")

        // FLAGS / INTERNALDATE come from the FETCH response line itself.
        for line in lines {
            if email["date"] as? String == "", line.contains("INTERNALDATE"),
               let m = line.range(of: "INTERNALDATE\\s+\"([^\"]+)\"", options: .regularExpression) {
                email["date"] = String(line[m])
                    .replacingOccurrences(of: "INTERNALDATE", with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            }
            if line.contains("FLAGS"),
               let m = line.range(of: "FLAGS\\s+\\(([^)]*)\\)", options: .regularExpression) {
                email["flags"] = String(line[m])
                    .replacingOccurrences(of: "FLAGS", with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
                    .components(separatedBy: " ")
                    .map { $0.trimmingCharacters(in: CharacterSet.alphanumerics.inverted) }
                    .filter { !$0.isEmpty }
            }
        }

        // Subject/From/To/Date are parsed from the BODY.PEEK[HEADER.FIELDS (...)] block, which
        // contains raw RFC822 header lines. Unfold continuation lines (leading space/tab) and
        // match `Header: value` case-insensitively. This is reliable, unlike parsing the
        // positional IMAP ENVELOPE structure.
        var currentKey: String? = nil
        var currentVal = ""
        func commit() {
            guard let key = currentKey else { return }
            let value = decodeMIMEHeader(currentVal.trimmingCharacters(in: .whitespacesAndNewlines))
            switch key {
            case "subject": email["subject"] = value
            case "from": email["from"] = value
            case "to": email["to"] = value.isEmpty ? [String]() : [value]
            case "date": if (email["date"] as? String)?.isEmpty != false { email["date"] = value }
            default: break
            }
            currentKey = nil
            currentVal = ""
        }
        for line in lines {
            // Header folding: a line beginning with whitespace continues the previous header.
            if let _ = currentKey, let first = line.first, first == " " || first == "\t" {
                currentVal += " " + line.trimmingCharacters(in: .whitespaces)
                continue
            }
            if let colon = line.firstIndex(of: ":") {
                let name = line[line.startIndex..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                if ["subject", "from", "to", "date"].contains(name) {
                    commit()
                    currentKey = name
                    currentVal = String(line[line.index(after: colon)...])
                    continue
                }
            }
            // Any non-header / structural line ends an in-progress header.
            if currentKey != nil { commit() }
        }
        commit()
        return email
    }

    // Decodes RFC 2047 encoded-words (=?charset?B/Q?text?=). Falls back to the raw value when
    // no encoded-word is present or decoding fails.
    private func decodeMIMEHeader(_ raw: String) -> String {
        guard raw.contains("=?") else { return raw }
        var result = ""
        var remainder = Substring(raw)
        while let start = remainder.range(of: "=?") {
            result += remainder[remainder.startIndex..<start.lowerBound]
            let afterStart = remainder[start.upperBound...]
            guard let qMark1 = afterStart.range(of: "?"),
                  let qMark2 = afterStart[qMark1.upperBound...].range(of: "?"),
                  let end = afterStart[qMark2.upperBound...].range(of: "?=") else {
                // Malformed; emit the rest verbatim.
                result += remainder[start.lowerBound...]
                return result
            }
            let charset = afterStart[afterStart.startIndex..<qMark1.lowerBound]
            let encoding = afterStart[qMark1.upperBound..<qMark2.lowerBound].uppercased()
            let text = String(afterStart[qMark2.upperBound..<end.lowerBound])
            result += decodeEncodedWord(text: text, encoding: encoding, charset: String(charset)) ?? "=?\(charset)?\(encoding)?\(text)?="
            remainder = afterStart[end.upperBound...]
        }
        result += remainder
        return result
    }

    private func decodeEncodedWord(text: String, encoding: String, charset: String) -> String? {
        let enc: String.Encoding = charset.lowercased().contains("utf-8") ? .utf8 : .isoLatin1
        if encoding == "B" {
            guard let data = Data(base64Encoded: text) else { return nil }
            return String(data: data, encoding: enc) ?? String(data: data, encoding: .utf8)
        }
        if encoding == "Q" {
            var bytes = [UInt8]()
            let chars = Array(text)
            var i = 0
            while i < chars.count {
                let c = chars[i]
                if c == "_" { bytes.append(0x20); i += 1 }
                else if c == "=", i + 2 < chars.count,
                        let hi = chars[i + 1].hexDigitValue, let lo = chars[i + 2].hexDigitValue {
                    bytes.append(UInt8(hi * 16 + lo)); i += 3
                } else { bytes.append(contentsOf: Array(String(c).utf8)); i += 1 }
            }
            return String(bytes: bytes, encoding: enc) ?? String(bytes: bytes, encoding: .utf8)
        }
        return nil
    }

    private func parseEmailBody(from response: String) -> String {
        // FETCH (BODY[]) returns the full RFC822 message inside an IMAP literal. Locate the
        // body region (the FETCH line opening the literal), then skip the RFC822 headers up to
        // and including the first blank line, returning only the message body that follows.
        let lines = response.components(separatedBy: "\r\n")
        var inLiteral = false
        var inBody = false
        var body = ""
        for line in lines {
            if !inLiteral {
                // The line that opens the literal looks like: * N FETCH (... BODY[] {12345}
                if line.contains("FETCH") && line.contains("BODY[") { inLiteral = true }
                continue
            }
            if !inBody {
                // Blank line separates RFC822 headers from the body.
                if line.isEmpty { inBody = true }
                continue
            }
            // Closing of the IMAP response: a lone ")" or the tagged "aNNN OK" status line.
            if line == ")" || line.range(of: "^[aA]\\d+ (OK|NO|BAD)", options: .regularExpression) != nil {
                break
            }
            body += line + "\r\n"
        }
        return body.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @objc static func requiresMainQueueSetup() -> Bool { return false }
}

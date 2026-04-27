//
//  ProjectClassifierModule.swift
//  genie
//
//  Uses Apple Foundation Models (iOS 26+) to classify a chat message against
//  existing projects and return the best-matching project ID, or nil if no
//  project is a good match.
//

import Foundation
import React
import FoundationModels

@objc(ProjectClassifier)
class ProjectClassifierModule: NSObject {

    // MARK: - RN thread config

    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: - Public method

    /// Classify `messageText` against `projects` and resolve with the matching
    /// project's id string, or NSNull if no project is a good fit.
    ///
    /// - Parameters:
    ///   - messageText: The first user message of the new chat.
    ///   - projects:    Array of dicts with keys "id", "name", "description".
    ///   - resolve:     Resolved with String (project id) or NSNull.
    ///   - reject:      Called on hard errors (model unavailable, etc.).
    @objc func classify(
        _ messageText: String,
        projects: [[String: String]],
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !projects.isEmpty else {
            resolve(NSNull())
            return
        }

        if #available(iOS 26.0, *) {
            Task {
                do {
                    let result = try await self.runClassification(
                        messageText: messageText,
                        projects: projects
                    )
                    resolve(result as Any)
                } catch {
                    // Graceful degradation: classification failure is non-fatal.
                    // Resolve with NSNull so the app simply shows no suggestion.
                    resolve(NSNull())
                }
            }
        } else {
            // Foundation Models not available on this OS version.
            resolve(NSNull())
        }
    }

    // MARK: - Private helpers

    @available(iOS 26.0, *)
    private func runClassification(
        messageText: String,
        projects: [[String: String]]
    ) async throws -> String? {
        let session = LanguageModelSession()

        // Build a concise project list for the prompt.
        let projectLines = projects.enumerated().map { idx, p in
            let name = p["name"] ?? ""
            let desc = p["description"] ?? ""
            return "\(idx + 1). \(name)\(desc.isEmpty ? "" : ": \(desc)")"
        }.joined(separator: "\n")

        let prompt = """
You are a project classifier. Given a user message and a list of projects, \
decide which project (if any) the message belongs to.

Projects:
\(projectLines)

User message: "\(messageText)"

Reply with ONLY the number of the matching project (e.g. "2"), or "0" if none \
of the projects is a good match. Do not explain.
"""

        let response = try await session.respond(to: prompt)
        let trimmed = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let index = Int(trimmed), index > 0, index <= projects.count else {
            return nil
        }

        return projects[index - 1]["id"]
    }
}

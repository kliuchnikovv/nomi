//
//  ProjectClassifierModule.swift
//  nomi
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
You are a strict project classifier. Decide whether a user message clearly \
belongs to one of the user's existing projects.

Projects:
\(projectLines)

User message: "\(messageText)"

Rules:
- Answer "0" by default. Most messages do NOT belong to any project.
- Only answer with a project number when the message is clearly and \
specifically about that project's topic (its name or description), not just \
loosely or generically related.
- A general question (e.g. trivia, a one-off factual question, small talk) \
belongs to NO project — answer "0".
- If you are unsure, answer "0".

Reply with ONLY a single number: the matching project's number, or "0" for no \
match. Do not explain.
"""

        let response = try await session.respond(to: prompt)
        let trimmed = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let index = Int(trimmed), index > 0, index <= projects.count else {
            return nil
        }

        return projects[index - 1]["id"]
    }
}

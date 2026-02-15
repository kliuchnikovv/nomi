//
//  IOSContactsManager.swift
//  Genie
//
//  iOS Contacts Manager for Contacts Framework integration
//

import Foundation
import React
import Contacts
import UIKit
import UIKit

@objc(IOSContactsManager)
class IOSContactsManager: NSObject {

    private let contactStore = CNContactStore()

    override init() {
        super.init()
    }

    @objc
    func checkPermissionStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        switch CNContactStore.authorizationStatus(for: .contacts) {
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
        requestPermissions { granted in
            resolve(granted)
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

    private func requestPermissions(_ resolve: @escaping (Bool) -> Void) {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized:
            resolve(true)
        case .denied, .restricted:
            print("[IOSContactsManager] Contacts access denied or restricted")
            resolve(false)
        case .notDetermined:
            contactStore.requestAccess(for: .contacts) { granted, _ in
                resolve(granted)
            }
        @unknown default:
            resolve(false)
        }
    }

    private func fetchContacts(keysToFetch: [CNKeyDescriptor]) -> [CNContact] {
        var result: [CNContact] = []
        let request = CNContactFetchRequest(keysToFetch: keysToFetch)

        do {
            try contactStore.enumerateContacts(with: request) { contact, _ in
                result.append(contact)
            }
        } catch {
            print("[IOSContactsManager] Error fetching contacts: \(error)")
        }

        return result
    }

    private func contactToDict(_ contact: CNContact) -> [String: Any] {
        var dict: [String: Any] = [
            "id": contact.identifier,
            "givenName": contact.givenName,
            "familyName": contact.familyName,
            "phoneNumbers": contact.phoneNumbers.map { pn in
                ["label": pn.label ?? "", "value": pn.value.stringValue]
            },
            "emailAddresses": contact.emailAddresses.map { ea in
                ["label": ea.label ?? "", "value": ea.value as String]
            },
            "postalAddresses": contact.postalAddresses.map { pa in
                let address = pa.value
                return [
                    "label": pa.label ?? "",
                    "street": address.street,
                    "city": address.city,
                    "state": address.state,
                    "postalCode": address.postalCode,
                    "country": address.country
                ]
            }
        ]

        if !contact.middleName.isEmpty {
            dict["middleName"] = contact.middleName
        }
        if !contact.nickname.isEmpty {
            dict["nickname"] = contact.nickname
        }
        if !contact.organizationName.isEmpty {
            dict["organization"] = contact.organizationName
        }
        if !contact.jobTitle.isEmpty {
            dict["jobTitle"] = contact.jobTitle
        }
        if !contact.note.isEmpty {
            dict["notes"] = contact.note
        }
        if let url = contact.urlAddresses.first?.value as String, !url.isEmpty {
            dict["url"] = url
        }
        if let birthday = contact.birthday, let date = birthday.date {
            dict["birthday"] = date.iso8601String
        }
        if let imageData = contact.imageData {
            dict["imageData"] = imageData.base64EncodedString()
        }
        if let thumbData = contact.thumbnailImageData {
            dict["thumbnailImageData"] = thumbData.base64EncodedString()
        }

        return dict
    }

    @objc
    func searchContacts(_ query: String, _ limit: Int, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            let keysToFetch: [CNKeyDescriptor] = [
                CNContactIdentifierKey as CNKeyDescriptor,
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactMiddleNameKey as CNKeyDescriptor,
                CNContactNicknameKey as CNKeyDescriptor,
                CNContactOrganizationNameKey as CNKeyDescriptor,
                CNContactJobTitleKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
                CNContactPostalAddressesKey as CNKeyDescriptor,
                CNContactNoteKey as CNKeyDescriptor,
                CNContactUrlAddressesKey as CNKeyDescriptor,
                CNContactBirthdayKey as CNKeyDescriptor,
                CNContactImageDataKey as CNKeyDescriptor,
                CNContactThumbnailImageDataKey as CNKeyDescriptor
            ]

            let contacts = self.fetchContacts(keysToFetch: keysToFetch)
            var results: [[String: Any]] = []

            for contact in contacts where results.count < limit {
                if query.isEmpty {
                    results.append(self.contactToDict(contact))
                    continue
                }

                let fullName = "\(contact.givenName) \(contact.familyName)".lowercased()
                let lowerQuery = query.lowercased()

                if fullName.contains(lowerQuery) ||
                   contact.phoneNumbers.contains(where: { $0.value.stringValue.contains(query) }) ||
                   contact.emailAddresses.contains(where: { ($0.value as String).lowercased().contains(lowerQuery) }) {
                    results.append(self.contactToDict(contact))
                }
            }

            resolve(results)
        }
    }

    @objc
    func getContact(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            let keysToFetch: [CNKeyDescriptor] = [
                CNContactIdentifierKey as CNKeyDescriptor,
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactMiddleNameKey as CNKeyDescriptor,
                CNContactNicknameKey as CNKeyDescriptor,
                CNContactOrganizationNameKey as CNKeyDescriptor,
                CNContactJobTitleKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
                CNContactPostalAddressesKey as CNKeyDescriptor,
                CNContactNoteKey as CNKeyDescriptor,
                CNContactUrlAddressesKey as CNKeyDescriptor,
                CNContactBirthdayKey as CNKeyDescriptor,
                CNContactImageDataKey as CNKeyDescriptor,
                CNContactThumbnailImageDataKey as CNKeyDescriptor
            ]

            do {
                let contact = try self.contactStore.unifiedContact(withIdentifier: id, keysToFetch: keysToFetch)
                resolve(self.contactToDict(contact))
            } catch {
                reject("NOT_FOUND", "Contact not found", error)
            }
        }
    }

    @objc
    func createContact(_ contactData: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            let contact = CNMutableContact()

            if let givenName = contactData["givenName"] as? String {
                contact.givenName = givenName
            }
            if let familyName = contactData["familyName"] as? String {
                contact.familyName = familyName
            }
            if let middleName = contactData["middleName"] as? String {
                contact.middleName = middleName
            }
            if let nickname = contactData["nickname"] as? String {
                contact.nickname = nickname
            }
            if let organization = contactData["organization"] as? String {
                contact.organizationName = organization
            }
            if let jobTitle = contactData["jobTitle"] as? String {
                contact.jobTitle = jobTitle
            }
            if let notes = contactData["notes"] as? String {
                contact.note = notes
            }
            if let urlString = contactData["url"] as? String, let url = URL(string: urlString) {
                contact.urlAddresses = [CNLabeledValue(label: CNLabelOther, value: url as NSString)]
            }

            if let phoneNumbers = contactData["phoneNumbers"] as? [[String: Any]] {
                contact.phoneNumbers = phoneNumbers.compactMap { pn in
                    guard let value = pn["value"] as? String,
                          let label = pn["label"] as? String else { return nil }
                    return CNLabeledValue(label: label as String, value: CNPhoneNumber(stringValue: value))
                }
            }

            if let emailAddresses = contactData["emailAddresses"] as? [[String: Any]] {
                contact.emailAddresses = emailAddresses.compactMap { ea in
                    guard let value = ea["value"] as? String,
                          let label = ea["label"] as? String else { return nil }
                    return CNLabeledValue(label: label as String, value: value as NSString)
                }
            }

            if let postalAddresses = contactData["postalAddresses"] as? [[String: Any]] {
                contact.postalAddresses = postalAddresses.compactMap { pa in
                    let address = CNMutablePostalAddress()
                    if let street = pa["street"] as? String { address.street = street }
                    if let city = pa["city"] as? String { address.city = city }
                    if let state = pa["state"] as? String { address.state = state }
                    if let postalCode = pa["postalCode"] as? String { address.postalCode = postalCode }
                    if let country = pa["country"] as? String { address.country = country }
                    return CNLabeledValue(label: CNLabelOther, value: address)
                }
            }

            if let birthdayString = contactData["birthday"] as? String {
                let formatter = ISO8601DateFormatter()
                if let birthday = formatter.date(from: birthdayString) {
                    contact.birthday = Calendar.current.dateComponents([.year, .month, .day], from: birthday)
                }
            }

            if let imageDataString = contactData["imageData"] as? String,
               let imageData = Data(base64Encoded: imageDataString) {
                contact.imageData = imageData
            }

            let saveRequest = CNSaveRequest()
            saveRequest.add(contact, toContainerWithIdentifier: nil)

            do {
                try self.contactStore.execute(saveRequest)
                resolve(self.contactToDict(contact))
            } catch {
                reject("CREATE_FAILED", "Failed to create contact", error)
            }
        }
    }

    @objc
    func updateContact(_ id: String, _ updates: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            let keysToFetch: [CNKeyDescriptor] = [
                CNContactIdentifierKey as CNKeyDescriptor,
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactMiddleNameKey as CNKeyDescriptor,
                CNContactNicknameKey as CNKeyDescriptor,
                CNContactOrganizationNameKey as CNKeyDescriptor,
                CNContactJobTitleKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
                CNContactPostalAddressesKey as CNKeyDescriptor,
                CNContactNoteKey as CNKeyDescriptor,
                CNContactUrlAddressesKey as CNKeyDescriptor,
                CNContactBirthdayKey as CNKeyDescriptor,
                CNContactImageDataKey as CNKeyDescriptor
            ]

            do {
                guard let mutableContact = try self.contactStore.unifiedContact(withIdentifier: id, keysToFetch: keysToFetch).mutableCopy() as? CNMutableContact else {
                    reject("NOT_FOUND", "Contact not found", nil)
                    return
                }

                if let givenName = updates["givenName"] as? String {
                    mutableContact.givenName = givenName
                }
                if let familyName = updates["familyName"] as? String {
                    mutableContact.familyName = familyName
                }
                if let middleName = updates["middleName"] as? String {
                    mutableContact.middleName = middleName
                }
                if let nickname = updates["nickname"] as? String {
                    mutableContact.nickname = nickname
                }
                if let organization = updates["organization"] as? String {
                    mutableContact.organizationName = organization
                }
                if let jobTitle = updates["jobTitle"] as? String {
                    mutableContact.jobTitle = jobTitle
                }
                if let notes = updates["notes"] as? String {
                    mutableContact.note = notes
                }
                if let urlString = updates["url"] as? String, let url = URL(string: urlString) {
                    mutableContact.urlAddresses = [CNLabeledValue(label: CNLabelOther, value: url as NSString)]
                }

                if let phoneNumbers = updates["phoneNumbers"] as? [[String: Any]] {
                    mutableContact.phoneNumbers = phoneNumbers.compactMap { pn in
                        guard let value = pn["value"] as? String,
                              let label = pn["label"] as? String else { return nil }
                        return CNLabeledValue(label: label as String, value: CNPhoneNumber(stringValue: value))
                    }
                }

                if let emailAddresses = updates["emailAddresses"] as? [[String: Any]] {
                    mutableContact.emailAddresses = emailAddresses.compactMap { ea in
                        guard let value = ea["value"] as? String,
                              let label = ea["label"] as? String else { return nil }
                        return CNLabeledValue(label: label as String, value: value as NSString)
                    }
                }

                if let postalAddresses = updates["postalAddresses"] as? [[String: Any]] {
                    mutableContact.postalAddresses = postalAddresses.compactMap { pa in
                        let address = CNMutablePostalAddress()
                        if let street = pa["street"] as? String { address.street = street }
                        if let city = pa["city"] as? String { address.city = city }
                        if let state = pa["state"] as? String { address.state = state }
                        if let postalCode = pa["postalCode"] as? String { address.postalCode = postalCode }
                        if let country = pa["country"] as? String { address.country = country }
                        return CNLabeledValue(label: CNLabelOther, value: address)
                    }
                }

                if let birthdayString = updates["birthday"] as? String {
                    let formatter = ISO8601DateFormatter()
                    if let birthday = formatter.date(from: birthdayString) {
                        mutableContact.birthday = Calendar.current.dateComponents([.year, .month, .day], from: birthday)
                    }
                }

                if let imageDataString = updates["imageData"] as? String,
                   let imageData = Data(base64Encoded: imageDataString) {
                    mutableContact.imageData = imageData
                }

                let saveRequest = CNSaveRequest()
                saveRequest.update(mutableContact)

                try self.contactStore.execute(saveRequest)
                resolve(self.contactToDict(mutableContact))
            } catch {
                reject("UPDATE_FAILED", "Failed to update contact", error)
            }
        }
    }

    @objc
    func deleteContact(_ id: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            let keysToFetch = [CNContactIdentifierKey as CNKeyDescriptor]

            do {
                guard let mutableContact = try self.contactStore.unifiedContact(withIdentifier: id, keysToFetch: keysToFetch).mutableCopy() as? CNMutableContact else {
                    reject("NOT_FOUND", "Contact not found", nil)
                    return
                }

                let saveRequest = CNSaveRequest()
                saveRequest.delete(mutableContact)

                try self.contactStore.execute(saveRequest)
                resolve(nil)
            } catch {
                reject("DELETE_FAILED", "Failed to delete contact", error)
            }
        }
    }

    @objc
    func getGroups(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        requestPermissions { granted in
            guard granted else {
                reject("PERMISSION_DENIED", "Contacts access not authorized", nil)
                return
            }

            do {
                let groups = try self.contactStore.groups(matching: nil)
                let result = groups.map { group in
                    ["id": group.identifier, "name": group.name]
                }
                resolve(result)
            } catch {
                reject("FETCH_FAILED", "Failed to fetch groups", error)
            }
        }
    }
}

extension Date {
    var iso8601String: String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: self)
    }
}

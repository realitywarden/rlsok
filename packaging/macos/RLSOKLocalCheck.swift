import AppKit
import Combine
import Darwin
import Foundation
import SwiftUI

private enum WorkspacePage: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case example = "Run example"
    case templates = "Interface setup"
    case guide = "Local guide"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .overview: return "square.grid.2x2"
        case .example: return "play.circle"
        case .templates: return "square.3.layers.3d"
        case .guide: return "doc.text"
        }
    }
}

@MainActor
private final class LocalCheckModel: ObservableObject {
    @Published var selectedPage: WorkspacePage = .templates
    @Published var isRunning = false
    @Published var isAssistantRunning = false
    @Published var latestReportURL: URL?
    @Published var status = "Ready for a local check"
    @Published var audit: [String] = [
        "Console opened — local files remain on this Mac.",
        "Robot command path is disabled in Local Check."
    ]

    let version: String
    let sourceCommit: String
    let platform: String
    private let resourceRoot: URL
    private var setupAssistantProcess: Process?

    init() {
        resourceRoot = Bundle.main.resourceURL!.appendingPathComponent("local-check", isDirectory: true)
        version = Self.readText(resourceRoot.appendingPathComponent("VERSION")) ?? "unknown"
        sourceCommit = Self.readText(resourceRoot.appendingPathComponent("SOURCE_COMMIT")) ?? "unknown"
        platform = Self.readText(resourceRoot.appendingPathComponent("PLATFORM")) ?? "darwin"
    }

    nonisolated static func selfCheck() throws -> String {
        guard let resources = Bundle.main.resourceURL else {
            throw ConsoleError("app_resource_directory_missing")
        }
        let root = resources.appendingPathComponent("local-check", isDirectory: true)
        let required = ["VERSION", "SOURCE_COMMIT", "PLATFORM", "START-HERE.md", "bin/rlsok", "bin/run-example"]
        for relativePath in required {
            guard FileManager.default.fileExists(atPath: root.appendingPathComponent(relativePath).path) else {
                throw ConsoleError("missing_resource:\(relativePath)")
            }
        }
        let version = try String(contentsOf: root.appendingPathComponent("VERSION"), encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == version else {
            throw ConsoleError("bundle_payload_version_mismatch")
        }
        for executable in ["bin/rlsok", "bin/run-example"] {
            guard FileManager.default.isExecutableFile(atPath: root.appendingPathComponent(executable).path) else {
                throw ConsoleError("resource_not_executable:\(executable)")
            }
        }
        return version
    }

    func runExample() {
        guard !isRunning else { return }
        selectedPage = .example
        isRunning = true
        status = "Running the included zero-command example"
        addAudit("Started included example. No robot endpoint is opened.")

        let root = resourceRoot
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let process = Process()
            let output = Pipe()
            process.executableURL = root.appendingPathComponent("bin/run-example")
            process.currentDirectoryURL = root
            process.standardOutput = output
            process.standardError = output
            do {
                try process.run()
                process.waitUntilExit()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                Task { @MainActor [weak self] in
                    self?.finishExample(exitCode: process.terminationStatus, output: text)
                }
            } catch {
                Task { @MainActor [weak self] in
                    self?.finishExample(exitCode: -1, output: error.localizedDescription)
                }
            }
        }
    }

    func openLatestReport() {
        guard let url = latestReportURL else { return }
        NSWorkspace.shared.open(url)
        addAudit("Opened the latest local report folder.")
    }

    func openGuide() {
        selectedPage = .guide
        let guide = resourceRoot.appendingPathComponent("START-HERE.md")
        NSWorkspace.shared.open(guide)
        addAudit("Opened the bundled Local Check guide.")
    }

    func startSetupAssistant() {
        guard !isAssistantRunning else { return }
        let process = Process()
        process.executableURL = resourceRoot.appendingPathComponent("bin/rlsok")
        process.arguments = ["setup-assistant"]
        process.currentDirectoryURL = resourceRoot
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.isAssistantRunning = false
                self?.setupAssistantProcess = nil
                self?.addAudit("Local Setup Assistant stopped.")
            }
        }
        do {
            try process.run()
            setupAssistantProcess = process
            isAssistantRunning = true
            addAudit("Opened Local Setup Assistant on this Mac only.")
        } catch {
            addAudit("Could not start Local Setup Assistant: \(error.localizedDescription)")
        }
    }

    func stopSetupAssistant() {
        setupAssistantProcess?.terminate()
    }

    private func finishExample(exitCode: Int32, output: String) {
        isRunning = false
        guard exitCode == 0 else {
            status = "Example did not complete"
            addAudit("Example failed (exit \(exitCode)): \(output.isEmpty ? "no diagnostic output" : output)")
            return
        }

        let candidate = URL(fileURLWithPath: output).standardizedFileURL
        let documentsRoot = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RLSOK", isDirectory: true).standardizedFileURL.path + "/"
        guard candidate.path.hasPrefix(documentsRoot),
              FileManager.default.fileExists(atPath: candidate.path) else {
            status = "Example returned an invalid report location"
            addAudit("Rejected report location outside Documents/RLSOK.")
            return
        }

        latestReportURL = candidate
        status = "Example complete — one match and one blocked change"
        addAudit("Completed: baseline WOULD_ALLOW; changed calibration WOULD_BLOCK.")
    }

    private func addAudit(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        audit.append("\(formatter.string(from: Date()))  \(message)")
    }

    nonisolated private static func readText(_ url: URL) -> String? {
        try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct ConsoleError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@main
private struct RLSOKLocalCheckApp: App {
    @StateObject private var model = LocalCheckModel()

    init() {
        if CommandLine.arguments.contains("--self-check") {
            do {
                let version = try LocalCheckModel.selfCheck()
                print("RLSOK_MAC_UI_SELF_CHECK_OK version=\(version)")
                Darwin.exit(EXIT_SUCCESS)
            } catch {
                FileHandle.standardError.write(Data("RLSOK_MAC_UI_SELF_CHECK_FAILED \(error.localizedDescription)\n".utf8))
                Darwin.exit(EXIT_FAILURE)
            }
        }
    }

    var body: some Scene {
        WindowGroup("RLSOK Local Check") {
            ConsoleRoot(model: model)
                .frame(minWidth: 980, minHeight: 680)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("Local Check") {
                Button("Run included example") { model.runExample() }
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(model.isRunning)
                Button("Open latest reports") { model.openLatestReport() }
                    .disabled(model.latestReportURL == nil)
                Divider()
                Button("Open local guide") { model.openGuide() }
            }
        }
    }
}

private struct ConsoleRoot: View {
    @ObservedObject var model: LocalCheckModel

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            Divider().overlay(Color.white.opacity(0.08))
            HStack(spacing: 0) {
                sidebar
                Divider().overlay(Color.white.opacity(0.08))
                content
            }
            Divider().overlay(Color.white.opacity(0.08))
            auditDrawer
        }
        .background(Color(red: 0.035, green: 0.047, blue: 0.067))
        .foregroundStyle(.white)
    }

    private var statusBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(Color(red: 0.25, green: 0.78, blue: 0.98))
            Text("RLSOK")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            Text("LOCAL CHECK")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            badge("LOCAL", color: .cyan)
            badge("SHADOW", color: .green)
            Spacer()
            Label("Zero dispatch", systemImage: "lock.shield")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.green.opacity(0.9))
            Text("v\(model.version)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
        .background(Color(red: 0.055, green: 0.07, blue: 0.095))
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WORKSPACE")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.top, 16)
            ForEach(WorkspacePage.allCases) { page in
                Button {
                    model.selectedPage = page
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: page.icon).frame(width: 18)
                        Text(page.rawValue)
                        Spacer()
                    }
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(model.selectedPage == page ? Color.white.opacity(0.09) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
            }
            Divider().overlay(Color.white.opacity(0.08)).padding(.vertical, 10)
            Text("CAPABILITY")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
            capability("Saved-file comparison", active: true)
            capability("Local reports", active: true)
            capability("Robot connection", active: false)
            Spacer()
            VStack(alignment: .leading, spacing: 5) {
                Text(model.platform)
                Text(String(model.sourceCommit.prefix(12)))
            }
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
            .padding(14)
        }
        .frame(width: 210)
        .background(Color(red: 0.045, green: 0.057, blue: 0.078))
    }

    private func capability(_ title: String, active: Bool) -> some View {
        HStack(spacing: 8) {
            Circle().fill(active ? Color.green : Color.gray).frame(width: 6, height: 6)
            Text(title)
        }
        .font(.system(size: 11))
        .foregroundStyle(active ? Color.white.opacity(0.78) : Color.white.opacity(0.38))
        .padding(.horizontal, 14)
        .frame(height: 26)
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            switch model.selectedPage {
            case .overview: overview
            case .example: examplePage
            case .templates: templatePage
            case .guide: guidePage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.035, green: 0.047, blue: 0.067))
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Local verification workspace", "Compare saved robot settings with the copy you reviewed. Nothing here can command a robot.")
            HStack(spacing: 12) {
                metric("SYSTEM", "READY", "Package and local runtime found", .green)
                metric("MODE", "SHADOW", "File comparison only", .cyan)
                metric("ROBOT I/O", "DISABLED", "No command transport", .orange)
            }
            actionPanel
            boundaryPanel
        }
        .padding(24)
    }

    private var examplePage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Included comparison", "One unchanged sample should allow; one changed calibration should block.")
            actionPanel
            if let report = model.latestReportURL {
                panel {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Reports saved locally").font(.headline)
                            Text(report.path).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Open reports") { model.openLatestReport() }
                    }
                }
            }
        }
        .padding(24)
    }

    private var guidePage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Use your own saved files", "The bundled guide explains supported recipes, required tools and the limits of each result.")
            panel {
                VStack(alignment: .leading, spacing: 14) {
                    Label("Private configurations stay on this Mac", systemImage: "internaldrive")
                        .font(.headline)
                    Text("A matching saved-file report does not establish which configuration a running controller loaded. Keep controller limits and independent safety in place.")
                        .foregroundStyle(.secondary)
                    Button("Open bundled guide") { model.openGuide() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(24)
    }

    private var templatePage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Local Setup Assistant", "Discover, compose, match and export without an AI service or cloud upload.")
            panel {
                VStack(alignment: .leading, spacing: 14) {
                    Label("Discover → compose → confirm", systemImage: "square.3.layers.3d")
                        .font(.headline)
                    Text("Open a project folder to identify robot descriptions and configuration candidates, then discover or import its interfaces. Reusable rules compose; machine-specific identity, controller and joint order are confirmed for this project. Meanings, units, frames and real examples still require confirmation.")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(model.isAssistantRunning ? "Assistant running" : "Open Local Setup Assistant") { model.startSetupAssistant() }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isAssistantRunning)
                        if model.isAssistantRunning {
                            Button("Stop") { model.stopSetupAssistant() }.buttonStyle(.bordered)
                        }
                    }
                    Button("Open interface setup guide") { model.openGuide() }
                        .buttonStyle(.borderedProminent)
                }
            }
            panel {
                VStack(alignment: .leading, spacing: 10) {
                    boundary("Templates and composition stay on this Mac", true)
                    boundary("Source, parser and checking rules remain separate", true)
                    boundary("Template matching proves hardware compatibility", false)
                }
            }
        }
        .padding(24)
    }

    private var actionPanel: some View {
        panel {
            HStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(model.selectedPage == .example ? "Run the included example" : "Connect your own project").font(.headline)
                    Text(model.selectedPage == .example ? model.status : "Find descriptions and configuration files, review missing facts, and prepare a local check workspace.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                if model.selectedPage == .example {
                    if model.isRunning { ProgressView().controlSize(.small) }
                    Button(model.isRunning ? "Running…" : "Run example") { model.runExample() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(model.isRunning)
                } else {
                    Button(model.isAssistantRunning ? "Assistant running" : "Open Local Setup Assistant") { model.startSetupAssistant() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(model.isAssistantRunning)
                    Button("Run example") { model.runExample() }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(model.isRunning)
                }
            }
        }
    }

    private var boundaryPanel: some View {
        panel {
            VStack(alignment: .leading, spacing: 12) {
                Text("What this console proves").font(.headline)
                boundary("Included app resources and native runtime are present", true)
                boundary("Saved inputs can produce local allow/block reports", true)
                boundary("A physical robot is connected or safe to move", false)
                boundary("A customer ran or accepted the result", false)
            }
        }
    }

    private func boundary(_ text: String, _ supported: Bool) -> some View {
        Label(text, systemImage: supported ? "checkmark.circle.fill" : "minus.circle")
            .font(.system(size: 12))
            .foregroundStyle(supported ? Color.white.opacity(0.82) : Color.white.opacity(0.46))
            .symbolRenderingMode(.hierarchical)
    }

    private func metric(_ label: String, _ value: String, _ detail: String, _ color: Color) -> some View {
        panel {
            VStack(alignment: .leading, spacing: 6) {
                Text(label).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(.secondary)
                Text(value).font(.system(size: 18, weight: .semibold, design: .rounded)).foregroundStyle(color)
                Text(detail).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func pageHeader(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 22, weight: .semibold, design: .rounded))
            Text(subtitle).font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private func panel<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(Color(red: 0.062, green: 0.078, blue: 0.105))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.08)))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var auditDrawer: some View {
        VStack(spacing: 0) {
            HStack {
                Label("LOCAL AUDIT", systemImage: "terminal")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                Spacer()
                Text("SESSION ONLY · NO UPLOAD")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .frame(height: 32)
            Divider().overlay(Color.white.opacity(0.08))
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(model.audit.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .id(index)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.68))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(10)
                }
                .onChange(of: model.audit.count) { _ in
                    withAnimation { proxy.scrollTo(model.audit.count - 1, anchor: .bottom) }
                }
            }
        }
        .frame(height: 160)
        .background(Color(red: 0.025, green: 0.033, blue: 0.047))
    }

    private func badge(_ title: String, color: Color) -> some View {
        Text(title)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

import SwiftUI

struct ContentView: View {
    @State private var ballSpeed: Double = 50
    @State private var ballFrequency: Double = 5
    @State private var launchAngle: Double = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    connectionStatusCard
                    livePreviewPlaceholder
                    slidersSection
                    recordStopButtons
                    downloadButton
                    machinePowerButton
                }
                .padding()
            }
            .navigationTitle("CourtVision")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    // MARK: - Connection Status

    private var connectionStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Raspberry Pi: Disconnected")
                .font(.headline)
            Text("IP Address: Not Connected")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Live Preview Placeholder

    private var livePreviewPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.black)
                .aspectRatio(16 / 9, contentMode: .fit)

            Text("Live Preview")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
        }
    }

    // MARK: - Sliders

    private var slidersSection: some View {
        VStack(spacing: 16) {
            sliderRow(title: "Ball Speed", value: $ballSpeed, range: 0...100)
            sliderRow(title: "Ball Frequency", value: $ballFrequency, range: 0...20)
            sliderRow(title: "Launch Angle", value: $launchAngle, range: 0...90)
        }
    }

    private func sliderRow(title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue))")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range)
        }
    }

    // MARK: - Buttons

    private var recordStopButtons: some View {
        HStack(spacing: 12) {
            Button { } label: {
                Text("Record")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button { } label: {
                Text("Stop")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var downloadButton: some View {
        Button { } label: {
            Text("Download Latest Video")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
    }

    private var machinePowerButton: some View {
        Button { } label: {
            Text("Machine Power: OFF")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }
}

#Preview {
    ContentView()
}

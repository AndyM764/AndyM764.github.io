#!/usr/bin/env python3
"""
Standalone bipolar stepper motor test for Raspberry Pi 5 + L298N.

Hardware:
  - Raspberry Pi 5
  - L298N motor driver
  - Motech MT-1704HS168A used as bipolar (centre taps disconnected)
  - 12 V external supply for the motor (Pi GND shared with L298N GND)

GPIO (BCM numbering):
  IN1 → GPIO14
  IN2 → GPIO4
  IN3 → GPIO17
  IN4 → GPIO27

Uses gpiozero (recommended on Raspberry Pi OS Bookworm / Pi 5).
"""

from time import sleep

from gpiozero import OutputDevice

# ---------------------------------------------------------------------------
# L298N input pins (BCM numbers)
# ---------------------------------------------------------------------------
IN1 = OutputDevice(14)
IN2 = OutputDevice(4)
IN3 = OutputDevice(17)
IN4 = OutputDevice(27)

# ---------------------------------------------------------------------------
# Full-step (dual-coil) sequence — one direction, good torque for testing
# Each tuple is (IN1, IN2, IN3, IN4)
# ---------------------------------------------------------------------------
FULL_STEP_SEQUENCE = [
    (1, 1, 0, 0),
    (0, 1, 1, 0),
    (0, 0, 1, 1),
    (1, 0, 0, 1),
]

# Delay between steps (seconds). Larger = slower rotation.
STEP_DELAY_S = 0.05


def set_step(a: int, b: int, c: int, d: int) -> None:
    """Drive the four L298N inputs for one step pattern."""
    IN1.value = a
    IN2.value = b
    IN3.value = c
    IN4.value = d


def cleanup() -> None:
    """Turn coils off and release GPIO pins."""
    set_step(0, 0, 0, 0)
    IN1.close()
    IN2.close()
    IN3.close()
    IN4.close()


def main() -> None:
    print("Stepper test running (full-step, one direction).")
    print("Press Ctrl+C to stop.")

    try:
        # Rotate continuously by repeating the full-step sequence
        while True:
            for step in FULL_STEP_SEQUENCE:
                set_step(*step)
                sleep(STEP_DELAY_S)
    except KeyboardInterrupt:
        # Ctrl+C — exit the loop cleanly
        print("\nStopping...")
    finally:
        # Always release GPIO, even on unexpected errors
        cleanup()
        print("GPIO cleaned up.")


if __name__ == "__main__":
    main()

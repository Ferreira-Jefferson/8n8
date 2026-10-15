import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DonatePanel } from "../DonatePanel";
import { PIX_PAYLOAD } from "../donate-qr";

afterEach(cleanup);

/** The CRC16/CCITT-FALSE every Pix code ends with, over everything before it. */
function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("DonatePanel", () => {
  it("shows the Pix QR under a Pix do Café summary", () => {
    render(<DonatePanel />);
    expect(screen.getByText("Pix do Café")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "QR Code Pix para doação" }),
    ).toBeTruthy();
  });

  it("copies the Pix code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DonatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar código Pix" }));
    await screen.findByText("Código copiado");
    expect(writeText).toHaveBeenCalledWith(PIX_PAYLOAD);
  });

  it("carries a valid Pix code: right CRC and no CPF or e-mail key", () => {
    expect(PIX_PAYLOAD.slice(-4)).toBe(crc16(PIX_PAYLOAD.slice(0, -4)));
    expect(PIX_PAYLOAD).toMatch(/br\.gov\.bcb\.pix0136[0-9a-f-]{36}/);
  });
});

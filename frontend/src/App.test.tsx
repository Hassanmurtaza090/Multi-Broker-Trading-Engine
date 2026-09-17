import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App (foundation)", () => {
  it("renders the scaffolded terminal heading", () => {
    render(<App />);
    expect(screen.getByText(/Multi-Broker Trading Engine/i)).toBeInTheDocument();
  });
});
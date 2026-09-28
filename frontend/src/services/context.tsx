/**
 * Services context (M11): injects the API client into the component tree.
 *
 * The default production value is a same-origin `ApiClient` (Vite proxies the
 * M10 gateway in dev); tests inject a mock without touching global fetch.
 */

import { createContext, useContext } from "react";

import { config } from "../config";
import { ApiClient } from "./api";

export interface TerminalServices {
  api: ApiClient;
}

export function createTerminalServices(apiBaseUrl: string = config.apiBaseUrl): TerminalServices {
  return { api: new ApiClient(apiBaseUrl) };
}

const defaultServices = createTerminalServices();

export const ServicesContext = createContext<TerminalServices>(defaultServices);

export function useServices(): TerminalServices {
  return useContext(ServicesContext);
}

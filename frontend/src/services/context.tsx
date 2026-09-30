/**
 * Services context (M11/M12): injects the API client into the component tree.
 *
 * The M12 composition wires the authService session into the ApiClient
 * (bearer attachment + single-flight 401 refresh/retry). Tests can inject a
 * mock client without touching global fetch.
 */

import { createContext, useContext } from "react";

import { config } from "../config";
import { ApiClient } from "./api";
import { authService } from "./auth";

export interface TerminalServices {
  api: ApiClient;
}

export function createTerminalServices(apiBaseUrl: string = config.apiBaseUrl): TerminalServices {
  const api = new ApiClient(apiBaseUrl, {
    getAccessToken: () => authService.getAccessToken(),
    refresh: () => authService.refresh(),
  });
  return { api };
}

const defaultServices = createTerminalServices();

export const ServicesContext = createContext<TerminalServices>(defaultServices);

export function useServices(): TerminalServices {
  return useContext(ServicesContext);
}

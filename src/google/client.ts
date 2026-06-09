import { google, type drive_v3, type sheets_v4 } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";

export interface GoogleClients {
  drive: drive_v3.Drive;
  sheets: sheets_v4.Sheets;
}

/**
 * Build authorized Drive + Sheets API clients from the cached OAuth token.
 * @throws NotAuthenticatedError if the user has not logged in.
 */
export async function getGoogleClients(): Promise<GoogleClients> {
  const auth = await getAuthenticatedClient();
  return {
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth }),
  };
}

export type { drive_v3, sheets_v4 };

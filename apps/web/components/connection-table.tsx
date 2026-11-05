"use client";

import { Fragment, useState } from "react";
import { revokeConnection } from "../app/(app)/connections/actions";
import { ConfirmPanel } from "./confirm";
import { Sig } from "./sig";

export type Connection = { clientId: string; name: string; connected: string };

export function ConnectionTable({ connections }: { connections: Connection[] }) {
  const [confirm, setConfirm] = useState("");
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">App</th>
            <th scope="col">Connected</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => (
            <Fragment key={connection.clientId}>
              <tr>
                <td>
                  <span className="app">
                    <span className="ic">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="5" width="18" height="14" rx="3" />
                        <path d="M7 10l3 2.5L7 15M12.5 15H17" strokeLinecap="round" />
                      </svg>
                    </span>
                    {connection.name}
                  </span>
                </td>
                <td>
                  <Sig tone="ok" quiet>
                    <span>{connection.connected}</span>
                  </Sig>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="btn sm danger"
                    type="button"
                    onClick={() => setConfirm(confirm === connection.clientId ? "" : connection.clientId)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
              {confirm === connection.clientId && (
                <tr>
                  <td colSpan={3}>
                    <ConfirmPanel
                      action={revokeConnection}
                      fields={{ clientId: connection.clientId }}
                      message={`Disconnect ${connection.name}. Chats it already has keep their content.`}
                      confirmLabel="Revoke"
                      onCancel={() => setConfirm("")}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

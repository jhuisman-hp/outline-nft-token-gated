/* eslint-disable no-console */
// import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BrowserProvider } from "ethers";
import { EmailIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Client } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import ButtonLarge from "~/components/ButtonLarge";
import InputLarge from "~/components/InputLarge";
import PluginIcon from "~/components/PluginIcon";
import env from "~/env";
import { client } from "~/utils/ApiClient";
import Desktop from "~/utils/Desktop";

type Props = {
  id: string;
  name: string;
  authUrl: string;
  isCreate: boolean;
  onEmailSuccess: (email: string) => void;
};

function useRedirectHref(authUrl: string) {
  // If we're on a custom domain or a subdomain then the auth must point to the
  // apex (env.URL) for authentication so that the state cookie can be set and read.
  // We pass the host into the auth URL so that the server can redirect on error
  // and keep the user on the same page.
  const { custom, teamSubdomain, host } = parseDomain(window.location.origin);
  const url = new URL(env.URL);
  url.pathname = authUrl;

  if (custom || teamSubdomain) {
    url.searchParams.set("host", host);
  }
  if (Desktop.isElectron()) {
    url.searchParams.set("client", Client.Desktop);
  }

  return url.toString();
}

function decodeJwt(jwt: string, json = true) {
  const parts = jwt.split(".");
  const payload = parts[1];
  const decoded = window.atob(payload);

  if (!json) {
    return decoded;
  }

  return JSON.parse(decoded);
}

function AuthenticationProvider(props: Props) {
  const { t } = useTranslation();
  const [showEmailSignin, setShowEmailSignin] = React.useState(false);
  const [isSubmitting, setSubmitting] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const { isCreate, id, name, authUrl } = props;

  const handleChangeEmail = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  };

  const handleSubmitEmail = async (
    event: React.SyntheticEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (showEmailSignin && email) {
      setSubmitting(true);

      try {
        const response = await client.post(event.currentTarget.action, {
          email,
          client: Desktop.isElectron() ? "desktop" : undefined,
        });

        if (response.redirect) {
          window.location.href = response.redirect;
        } else {
          props.onEmailSuccess(email);
        }
      } finally {
        setSubmitting(false);
      }
    } else {
      setShowEmailSignin(true);
    }
  };

  async function verifySignature(
    jwt: string,
    message: string,
    signature: string
  ) {
    const url = `${env.URL}/auth/siwe`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jwt,
        message,
        signature,
      }),
    };

    await fetch(url, options);
  }

  const handleSubmitSiwe = async () => {
    if (id === "siwe") {
      // TODO: Change this temporary provider with a proper one
      const provider = new BrowserProvider(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as Window & typeof globalThis & { ethereum?: any }).ethereum
      );

      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const params = {
        domain: window.location.host,
        origin: window.location.origin,
        chainId: 1,
        address,
      };

      const URLFormattedParams = new URLSearchParams();

      Object.keys(params).forEach((key) => {
        URLFormattedParams.append(key, params[key]);
      });

      const url = `${env.URL}/auth/siwe/jwt?${URLFormattedParams.toString()}`;

      const options = {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      };

      const data = await fetch(url, options);

      const json = await data.json();
      const jwt = json.jwt;

      const decoded = decodeJwt(jwt);

      if (!decoded || typeof decoded === "string") {
        return;
      }

      const message = decoded.message;
      const signature = await signer.signMessage(message);

      await verifySignature(jwt, message, signature).then(() => {
        window.location.href = `${env.URL}/home`;
      });
    }
  };

  const href = useRedirectHref(authUrl);

  if (id === "email") {
    if (isCreate) {
      return null;
    }

    return (
      <Wrapper>
        <Form method="POST" action="/auth/email" onSubmit={handleSubmitEmail}>
          {showEmailSignin ? (
            <>
              <InputLarge
                type="email"
                name="email"
                placeholder="me@domain.com"
                value={email}
                onChange={handleChangeEmail}
                disabled={isSubmitting}
                autoFocus
                required
                short
              />
              <ButtonLarge type="submit" disabled={isSubmitting}>
                {t("Sign In")} →
              </ButtonLarge>
            </>
          ) : (
            <ButtonLarge type="submit" icon={<EmailIcon />} fullwidth>
              {t("Continue with Email")}
            </ButtonLarge>
          )}
        </Form>
      </Wrapper>
    );
  }

  if (id === "siwe") {
    if (isCreate) {
      return null;
    }

    return (
      <Wrapper>
        <ButtonLarge onClick={handleSubmitSiwe} fullwidth>
          Sign in with Web3
        </ButtonLarge>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <ButtonLarge
        onClick={() => (window.location.href = href)}
        icon={<PluginIcon id={id} />}
        fullwidth
      >
        {t("Continue with {{ authProviderName }}", {
          authProviderName: name,
        })}
      </ButtonLarge>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  width: 100%;
`;

const Form = styled.form`
  width: 100%;
  display: flex;
  justify-content: space-between;
`;

export default AuthenticationProvider;

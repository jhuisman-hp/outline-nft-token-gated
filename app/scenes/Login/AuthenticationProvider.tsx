import { ConnectButton } from "@rainbow-me/rainbowkit";
import { EmailIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useAccount, useSignMessage } from "wagmi";
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

async function getEthereumJWT(walletAddress: string, chainId: number) {
  const url = new URL(`${env.URL}/auth/ethereum.jwt`);

  url.searchParams.set("walletAddress", walletAddress);
  url.searchParams.set("chainId", chainId.toString());
  url.searchParams.set("domain", window.location.host);
  url.searchParams.set("uri", window.location.origin);

  const options = {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  };

  const response = await fetch(url.toString(), options);
  const data = await response.json();
  const jwt = data.jwt;

  return jwt;
}

type GetAccountResult = ReturnType<typeof useAccount>;
type AsyncSigner = ReturnType<typeof useSignMessage>["signMessageAsync"];

async function signInWithEthereum(
  account: GetAccountResult,
  signAsync: AsyncSigner
) {
  if (!account.address || !account.isConnected) {
    throw new Error("No account connected");
  }

  const chainId = await account.connector?.getChainId();

  if (!chainId) {
    throw new Error("No chainId");
  }

  const jwt = await getEthereumJWT(account.address, chainId);
  const decodedJwt = JSON.parse(window.atob(jwt.split(".")[1]));
  const message = decodedJwt.message;

  const signature = await signAsync({ message });

  if (!signature) {
    throw new Error("No signature");
  }

  await authenticateEthereumUser(jwt, signature).then((response) => {
    // Navigate to /home after successful authentication.
    if (response.redirected) {
      window.location.href = response.url;
    }
  });
}

async function authenticateEthereumUser(jwt: string, signature: string) {
  const url = `${env.URL}/auth/ethereum`;

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jwt, signature }),
  };

  const response = await fetch(url, options);
  return response;
}

function AuthenticationProvider(props: Props) {
  const { t } = useTranslation();
  const [showEmailSignin, setShowEmailSignin] = React.useState(false);
  const [isSubmitting, setSubmitting] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const { isCreate, id, name, authUrl } = props;

  const { signMessageAsync } = useSignMessage();

  const account = useAccount();

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

  if (id === "ethereum") {
    if (isCreate) {
      return null;
    }

    if (!account.address || !account.isConnected) {
      return <ConnectButton showBalance={false} />;
    } else {
      return (
        <>
          <ButtonLarge
            fullwidth
            onClick={() => signInWithEthereum(account, signMessageAsync)}
          >
            {t("Sign in with ethereum as {{address}}", {
              address:
                account.address?.toString().slice(0, 6) +
                "..." +
                account.address?.toString().slice(-4),
            })}
          </ButtonLarge>
          <ConnectButton showBalance={false} />
        </>
      );
    }
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

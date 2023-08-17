import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, getDefaultWallets } from "@rainbow-me/rainbowkit";
import * as React from "react";
import { configureChains, createConfig, WagmiConfig } from "wagmi";
import { mainnet, polygon, optimism, arbitrum, zora } from "wagmi/chains";
import { alchemyProvider } from "wagmi/providers/alchemy";
import { publicProvider } from "wagmi/providers/public";
import env from "@shared/env";

type Props = {
  children: React.ReactNode;
};

const { chains, publicClient } = configureChains(
  [mainnet, polygon, optimism, arbitrum, zora],
  [alchemyProvider({ apiKey: env.ALCHEMY_ID }), publicProvider()]
);

const { connectors } = getDefaultWallets({
  appName: "Token",
  projectId: env.WALLETCONNECT_PROJECT_ID,
  chains,
});

const wagmiConfig = createConfig({
  autoConnect: true,
  publicClient,
  connectors,
});

const Web3Provider = (props: Props) => {
  const { children } = props;

  return (
    <WagmiConfig config={wagmiConfig}>
      <RainbowKitProvider chains={chains}>{children}</RainbowKitProvider>
    </WagmiConfig>
  );
};

export default Web3Provider;

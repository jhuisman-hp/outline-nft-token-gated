/* eslint-disable no-console */

import { sign, verify } from "jsonwebtoken";
import Router from "koa-router";
import { generateNonce, SiweErrorType, SiweMessage } from "siwe";
import { Client } from "@shared/types";
import env from "@server/env";
import { User } from "@server/models";
import { signIn } from "@server/utils/authentication";
import { getTeamFromContext } from "@server/utils/passport";
import { assertPresent } from "@server/validation";

const router = new Router();

router.get("siwe/jwt", async (ctx) => {
  const address = ctx.request.query.address as string;
  const domain = ctx.request.query.domain as string;
  const origin = ctx.request.query.origin as string;
  const chainId = ctx.request.query.chainId as string;

  assertPresent(address, "Unauthorized, no address provided");
  assertPresent(domain, "Unauthorized, no domain provided");
  assertPresent(origin, "Unauthorized, no origin provided");
  assertPresent(chainId, "Unauthorized, no chainId provided");

  const nonce = generateNonce();
  const statement = `Sign in with ethereum for ${env.URL} with address ${address}`;

  const siweMessage = new SiweMessage({
    address,
    nonce,
    statement,
    domain,
    uri: origin,
    version: "1",
    chainId: parseInt(chainId, 10),
  });

  const message = siweMessage.prepareMessage();

  const jwt = sign(
    { message, nonce, address, domain, origin, statement, chainId },
    env.SECRET_KEY
  );

  ctx.body = { jwt };
});

router.post("siwe", async (ctx) => {
  const { jwt, message, signature } = ctx.request.body;

  assertPresent(jwt, "Unauthorized, no jwt provided");
  assertPresent(message, "Unauthorized, no message provided");
  assertPresent(signature, "Unauthorized, no signature provided");

  try {
    const isJwtVerified = verify(jwt, env.SECRET_KEY);

    if (!isJwtVerified || typeof isJwtVerified === "string") {
      throw new Error("Unauthorized, jwt not verified");
    }

    const { nonce } = isJwtVerified as {
      nonce: string;
      address: string;
    };

    if (!nonce) {
      throw new Error("Unauthorized, no nonce provided");
    }

    const siweMessage = new SiweMessage(message);

    const { data: siweData, success: isSiweVerified } =
      await siweMessage.verify({
        signature,
        nonce,
      });

    if (!isSiweVerified) {
      throw new Error("Unauthorized, siwe not verified");
    }

    const address = siweData.address;

    await verifyAddressHasNft(address, env.ACCESS_TOKEN_NFT_CONTRACT_ADDRESS);
    await signInWithAddress(ctx, address);
  } catch (err) {
    switch (err) {
      case SiweErrorType:
        ctx.throw(401, err.message);
        break;
      default:
        console.error(err);
        ctx.throw(401, "Unauthorized");
    }
  }
});

const verifyAddressHasNft = async (
  address: string,
  contractAddress?: string
) => {
  if (!contractAddress) {
    // There is no contract address, so we don't need to verify the address has the NFT.
    return;
  }

  const mainNetNFTCheckerURL =
    "https://eth-mainnet.g.alchemy.com/nft/v2/S1rxChI0JjCyuNftYcB5CrDFUdKgCh9u/getNFTs";

  const params = new URLSearchParams({
    owner: address,
    pageKey: "s",
    pageSize: "100",
    withMetadata: "false",
    contractAdresses: contractAddress,
  });

  const url = `${mainNetNFTCheckerURL}?${params}`;
  console.log("data", url);

  const result = await fetch(url, { method: "GET" });

  const data = await result.json();

  if (!data || data.totalCount === 0) {
    throw new Error("Unauthorized, address does not have the NFT");
  }

  return;
};

const signInWithAddress = async (
  ctx: Router.IRouterContext,
  address: string
) => {
  const client = ctx.request.query.client as Client;
  const team = await getTeamFromContext(ctx);

  if (!team) {
    throw new Error("Unauthorized, no team found");
  }

  const email = `${address}@web3.eth`;

  let isNewUser = false;

  let user = await User.findOne({
    where: {
      email,
    },
  });

  if (!user) {
    isNewUser = true;
    user = await User.create({
      teamId: team?.id,
      name: address,
      email,
      service: null,
      isAdmin: false,
      isViewer: true,
    });
  }

  await signIn(ctx, "siwe", {
    user,
    team,
    client,
    isNewTeam: false,
    isNewUser,
  });

  ctx.redirect(`${env.URL}/app`);
};

export default router;

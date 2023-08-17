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

type TokenContent = {
  message: string;
  nonce: string;
};

async function walletHasNFT(walletAddress: string, contractAddress: string) {
  const checkupURI =
    "https://eth-mainnet.g.alchemy.com/nft/v2/S1rxChI0JjCyuNftYcB5CrDFUdKgCh9u/getNFTs";

  const params = new URLSearchParams({
    owner: walletAddress,
    pageKey: "s",
    pageSize: "100",
    withMetadata: "false",
    contractAdresses: contractAddress,
  });

  const url = `${checkupURI}?${params}`;

  const result = await fetch(url, { method: "GET" });
  const data = await result.json();

  if (data && data.totalCount > 0) {
    return true;
  }

  return false;
}

async function provisionUserWithWalletAddress(
  ctx: Router.RouterContext,
  walletAddress: string
) {
  const client = ctx.request.query.client as Client;
  const team = await getTeamFromContext(ctx);

  if (!team) {
    throw new Error(
      "Something went wrong, could not find team in application context"
    );
  }

  const email = `${walletAddress}@web3.eth`;

  let isNewUser = false;
  let user = await User.findOne({ where: { email } });

  if (!user) {
    isNewUser = true;
    user = await User.create({
      teamId: team.id,
      email,
      name: walletAddress,
      service: "ethereum",
    });
  }

  await signIn(ctx, "ethereum", {
    client,
    user,
    team,
    isNewUser,
    isNewTeam: false,
  });

  return ctx.redirect(`${env.URL}/app`);
}

router.get("ethereum.jwt", (ctx) => {
  const walletAddress = ctx.request.query.walletAddress as string;
  const domain = ctx.request.query.domain as string;
  const uri = ctx.request.query.uri as string;
  const chainId = parseInt(ctx.request.query.chainId as string);

  assertPresent(walletAddress, "Wallet address is required");
  assertPresent(chainId, "Chain ID is required");
  assertPresent(domain, "Domain is required");
  assertPresent(uri, "URI is required");

  const nonce = generateNonce();

  const siweMessage = new SiweMessage({
    address: walletAddress,
    nonce,
    chainId,
    domain,
    uri,
    version: "1",
  });

  const message = siweMessage.prepareMessage();

  const tokenContent: TokenContent = {
    message,
    nonce,
  };

  const token = sign(tokenContent, env.SECRET_KEY);

  ctx.body = {
    jwt: token,
  };
});

router.post("ethereum", async (ctx) => {
  const { jwt, signature } = ctx.request.body;

  assertPresent(jwt, "JWT is required");
  assertPresent(signature, "Signature is required");

  try {
    const { message, nonce } = verify(jwt, env.SECRET_KEY) as TokenContent;
    const siweMessage = new SiweMessage(message);

    const {
      success,
      data: { address },
    } = await siweMessage.verify({
      signature,
      nonce,
    });

    if (!success) {
      return ctx.throw(401, "Signature is invalid");
    }

    const contractAddress = env.NFT_CONTRACT_ADDRESS;

    if (!contractAddress) {
      // There is no NFT contract address, so we can't check ownership.
      // Here we just continue with the sign in process.
      return provisionUserWithWalletAddress(ctx, address);
    }

    const hasNft = await walletHasNFT(address, contractAddress);

    if (!hasNft) {
      return ctx.throw(401, "You don't have the required NFT");
    }

    return provisionUserWithWalletAddress(ctx, address);
  } catch (err) {
    if (err === SiweErrorType) {
      return ctx.throw(401, err.message);
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
      return ctx.throw(401, "Unauthorized");
    }
  }
});

export default router;

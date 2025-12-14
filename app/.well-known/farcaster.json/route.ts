import { minikitConfig } from '../../../minikit.config';

export async function GET() {
  return Response.json({
    accountAssociation: minikitConfig.accountAssociation,
    baseBuilder: minikitConfig.baseBuilder,
    // Base Mini App manifest schema expects `miniapp`
    miniapp: minikitConfig.miniapp,
  });
}
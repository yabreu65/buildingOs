import { MODULE_METADATA } from '@nestjs/common/constants';
import { FinanzasModule } from './finanzas.module';
import { LiquidationEngineController } from './liquidation-engine.controller';
import { LiquidationsController } from './liquidations.controller';

describe('FinanzasModule', () => {
  it('registers only the hardened liquidation controller route', () => {
    const controllersMetadata = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      FinanzasModule,
    ) as unknown;

    if (!Array.isArray(controllersMetadata)) {
      throw new Error('FinanzasModule controller metadata is missing');
    }

    const controllers = controllersMetadata;

    expect(controllers).toContain(LiquidationsController);
    expect(controllers).not.toContain(LiquidationEngineController);
  });
});

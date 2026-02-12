import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://192.168.1.56:3000",
      "http://192.168.1.56:3001",
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const config = new DocumentBuilder()
    .setTitle("BuildingOS API")
    .setDescription("The BuildingOS API description")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger running on http://localhost:${port}/api`);
}

bootstrap();

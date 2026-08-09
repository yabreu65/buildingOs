import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator';

export function IsStrictDateString(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'IsStrictDateString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          if (value.trim() !== value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

          const date = new Date(`${value}T00:00:00.000Z`);
          return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
        },
        defaultMessage(validationArguments?: ValidationArguments): string {
          return `${validationArguments?.property ?? 'value'} must be a valid YYYY-MM-DD date`;
        },
      },
    });
  };
}

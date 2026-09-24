import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';
import { TIPOS_OPERACAO } from '../../../../domain/value-objects/TipoOperacao';

/**
 * DTO do body de `POST /v1/contratos/{id_contrato}/autorizacoes`
 * (OpenAPI `CriarAutorizacaoRequest`, `additionalProperties: false`).
 *
 * A validação estrutural (campos/tipos) vive aqui via class-validator;
 * invariantes de negócio continuam no domínio (ValorMonetario/TipoOperacao).
 */
export class CriarAutorizacaoDto {
  @IsString()
  @IsNotEmpty()
  id_conta!: string;

  @IsNumber()
  @IsPositive()
  valor!: number;

  @IsString()
  @Length(3, 3)
  moeda!: string;

  @IsIn(TIPOS_OPERACAO)
  tipo_operacao!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id_estabelecimento?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

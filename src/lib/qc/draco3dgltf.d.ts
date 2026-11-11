// draco3dgltf ships no types. QC only decodes Draco inputs (ADR 003 O7).
declare module "draco3dgltf" {
  const draco3d: {
    createDecoderModule(options?: object): Promise<unknown>;
    createEncoderModule(options?: object): Promise<unknown>;
  };
  export default draco3d;
}
